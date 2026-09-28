import { Env, GHListName, IssueElement } from "./types";

function GetLogDate() {
	const d = new Date();

	const year = d.getUTCFullYear();
	const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
	const day = d.getUTCDate().toString().padStart(2, '0');
	const hours = d.getUTCHours().toString().padStart(2, '0');
	const mins = d.getUTCMinutes().toString().padStart(2, '0');
	const seconds = d.getUTCSeconds().toString().padStart(2, '0');
	const millis = d.getUTCMilliseconds().toString().padStart(3, '0');
	return `${year}/${month}/${day}@${hours}:${mins}:${seconds}.${millis}`;
}

export function LOG(txt: string) {
	console.log(`${GetLogDate()} | ${txt}`);
}

export async function GetGithubIssues(env: Env, ghlist: GHListName, updated_at: number): Promise<IssueElement[]> {
	const PER_PAGE = 100;
	const ACCESS_TOKEN = env.ACCESS_TOKEN;

	const issues: IssueElement[] = [];
	if (updated_at != 0) {
		let since = '&since=';
		// YYYY-MM-DDTHH:MM:SSZ
		const d = new Date((updated_at - 35) * 1000); // Minus 35 seconds. D1 can sometimes timeout and the timeouts are around 30-32 seconds long
		const year = d.getUTCFullYear();
		const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
		const day = d.getUTCDate().toString().padStart(2, '0');
		const hours = d.getUTCHours().toString().padStart(2, '0');
		const mins = d.getUTCMinutes().toString().padStart(2, '0');
		const seconds = d.getUTCSeconds().toString().padStart(2, '0');
		since += `${year}-${month}-${day}T${hours}:${mins}:${seconds}Z`;

		let shouldGetMore = true;
		let i = 1;
		while (shouldGetMore) {
			let r = await (fetch(`https://api.github.com/repos/${ghlist}/issues?state=all&sort=updated&page=${i++}&per_page=${PER_PAGE}${since}`, {
				headers: {
					'Authorization': `Bearer ${ACCESS_TOKEN}`,
					'Accept': `application/vnd.github+json`,
					'X-GitHub-Api-Version': '2026-03-10',
					'User-Agent': 'Vita3K API Worker'
				}
			}).then(r => r.json() as Promise<IssueElement[]>));

			if (!Array.isArray(r)) {
				console.error("Github issue list is not an array.");
				throw new Error(r);
			}

			const filteredIssues = r.filter((i) => typeof i.pull_request == 'undefined');
			issues.push(...filteredIssues);
			if (r.length != PER_PAGE) {
				// we got less issues this page, so this is the last one
				shouldGetMore = false;
			}
		}

		LOG(`${issues.length} Issues had activity in ${ghlist} since ${since}`);
	} else {
		LOG(`timestamp for list ${ghlist} is 0, getting all issues...`);
		// update_at is 0, so that means most likely the list is empty, get all pages of all open issues
		// and even if there is some entries in the list, they will get deleted anyways
		const numPagesReq = await fetch(`https://api.github.com/repos/${ghlist}`, {
			headers: {
				'Authorization': `Bearer ${ACCESS_TOKEN}`,
				'Accept': `application/vnd.github+json`,
				'X-GitHub-Api-Version': '2026-03-10',
				'User-Agent': 'Vita3K API Worker'
			}
		});

		const numPagesJson: any = await numPagesReq.json();
		const numberOfEntries = numPagesJson.open_issues_count;
		const numberOfPages = Math.ceil(numberOfEntries / PER_PAGE);

		LOG(`There are ${numberOfEntries} open issues, totaling to ${numberOfPages} pages`);

		const fetches: Promise<IssueElement[]>[] = [];
		for (let i = 1; i <= numberOfPages; i++) {
			fetches.push(fetch(`https://api.github.com/repos/${ghlist}/issues?state=open&page=${i}&per_page=${PER_PAGE}`, {
				headers: {
					'Authorization': `Bearer ${ACCESS_TOKEN}`,
					'Accept': `application/vnd.github+json`,
					'X-GitHub-Api-Version': '2026-03-10',
					'User-Agent': 'Vita3K API Worker'
				}
			}).then(r => r.json() as Promise<IssueElement[]>));
		};

		const pages = await Promise.all(fetches);
		pages.forEach(page => {
			const filteredIssues = page.filter((i) => typeof i.pull_request == 'undefined');
			issues.push(...filteredIssues);
		});
		LOG(`${issues.length} Issues were fetched across ${pages.length} pages`);
	}

	return issues;
}

/**
 * awaits a function, but with multiple attempts and wait time between attempts
 * @param fn Function pointer to the function to await for
 * @param awaitArgs Array of arguments to pass to the awaiting function
 * @param retries How many attempts
 * @param interval How many milliseconds are there between each attempt
 * @param errHandler What to do every time the await gets rejected
 * @returns The end result in case the function resolves correctly
 */
export function awaitWithRetry<Args extends any[], ReturnType>(
	fn: (...args: Args) => Promise<ReturnType>,
	awaitArgs: Args,
	retries: number,
	interval: number,
	errHandler: (err: unknown) => void
): Promise<ReturnType> {
	return new Promise((resolve, reject) => {
		let attempts = retries;

		async function attempt() {
			if (!attempts)
				return reject(new Error('Ran out of tries.'));
			try {
				const ret = await fn(...awaitArgs);
				resolve(ret);
			} catch (err) {
				errHandler(err);
				attempts--;
				setTimeout(attempt, interval);
			}
		}

		attempt();
	});
}


// DB/D1 stuff
//#region DB stuff
function dbDropTables(env: Env) {
	let batch: D1PreparedStatement[] = [];

	// Delete teh tables in order (children to master)
	batch.push(env.DB.prepare(
		'DROP TABLE IF EXISTS `list`'));
	batch.push(env.DB.prepare(
		'DROP TABLE IF EXISTS `labels`'));
	batch.push(env.DB.prepare(
		'DROP TABLE IF EXISTS `list_info`'));
	return batch;
}

async function createListInfoSchema(env: Env) {
	return await env.DB.prepare(
		'CREATE TABLE `list_info` ( \
  `name` varchar(64) PRIMARY KEY NOT NULL, \
  `githubName` varchar(128) NOT NULL, \
  `timestamp` INTEGER NOT NULL DEFAULT 0 \
)').run();
}

async function createLabelsSchema(env: Env) {
	return await env.DB.prepare(
		'CREATE TABLE `labels` ( \
  `name` varchar(64) NOT NULL, \
  `label` varchar(64) NOT NULL, \
  PRIMARY KEY(`name`, `label`), \
  FOREIGN KEY(`name`) REFERENCES list_info(`name`) \
)').run();
}


async function createListSchema(env: Env) {
	return await env.DB.prepare(
		'CREATE TABLE `list` ( \
  `type` varchar(64) NOT NULL, \
  `name` varchar(1024) DEFAULT NULL, \
  `titleId` varchar(10) DEFAULT NULL, \
  `status` varchar(64) DEFAULT NULL, \
  `color` varchar(7) DEFAULT NULL, \
  `issueId` INTEGER NOT NULL, \
  PRIMARY KEY(`type`, `issueId`), \
  FOREIGN KEY(`type`) REFERENCES list_info(`name`) \
); \
DROP TRIGGER IF EXISTS `timestmap_update`; \
CREATE TRIGGER `timestmap_update` AFTER INSERT \
ON `list` \
BEGIN \
  UPDATE list_info SET timestamp = unixepoch() WHERE name = new.type; \
END;').run();
}

function dbSetupInsertStatementsRepo(env: Env) {
	let batch: D1PreparedStatement[] = [];

	const repos = [
		['commercial', 'Vita3K/compatibility']
	];

	for (const repo of repos) {
		batch.push(env.DB.prepare(
			'INSERT INTO `list_info` (`name`, `githubName`) VALUES (?, ?)'
		).bind(repo[0], repo[1]));
	}

	return batch;
}


function dbSetupInsertStatementsLabels(env: Env) {
	let batch: D1PreparedStatement[] = [];

	const labels = {
		commercial: [
			'Playable',
			'Ingame +',
			'Ingame -',
			'Menu',
			'Intro',
			'Bootable',
			'Nothing'
		]
	};

	for (const list in labels) {
		for (const label of labels[list as keyof typeof labels]) {
			batch.push(env.DB.prepare(
				'INSERT INTO `labels` (`name`, `label`) VALUES (?, ?)'
			).bind(list, label));
		}
	}

	return batch;
}


async function tableExists(env: Env, table: string) {
	const res = await env.DB.prepare('SELECT name FROM sqlite_master WHERE type="table" AND name=?')
		.bind(table).run();

	return res.results.length == 1;
}

/**
 * Function in charge of making sure the database is ready to use for fetches and cron jobs
 * @param env 
 */
export async function preChecks(env: Env) {
	const [
		list_infoExists,
		labelsExists,
		listExists
	] = await Promise.all([
		tableExists(env, 'list_info'),
		tableExists(env, 'labels'),
		tableExists(env, 'list'),
	]);


	// List info
	if (!list_infoExists) {
		console.log('Creating list_info');
		await createListInfoSchema(env);
	}
	const list_info = await env.DB.prepare('SELECT * FROM `list_info`').run();
	if (list_info.results.length == 0) {
		console.log('Inserting list_info');
		await env.DB.batch(dbSetupInsertStatementsRepo(env));
	}

	// Labels
	if (!labelsExists) {
		console.log('Creating labels');
		await createLabelsSchema(env);
	}
	const labels = await env.DB.prepare('SELECT * FROM `labels`').run();
	if (labels.results.length == 0) {
		console.log('Inserting labels');
		await env.DB.batch(dbSetupInsertStatementsLabels(env));
	}

	// List
	if (!listExists) {
		console.log('Creating list');
		await createListSchema(env);
	}
}

export async function recreateDB(env: Env) {
	console.log('Recreating DB...');
	await dbDropTables(env);
	console.log('Creating...')
	await preChecks(env);
	console.log('Done creating DB');
}

//#endregion