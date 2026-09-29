import { Env } from "./types";

import { Octokit } from 'octokit'

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

/**
 * 
 * @param auth GitHub access token
 * @param owner Github repository owner
 * @param repo Github repository name
 * @param updated_at last time the list was updated at
 * @returns A list of issues which had changes since updated_at
 */
export async function GetGithubIssues(auth: string | undefined, owner: string, repo: string, updated_at: number) {
	if (!auth) {
		LOG(`Invalid ACCESS_TOKEN`)
		return [];
	}

	const octokit = new Octokit({
		auth: auth,
		userAgent: 'Vita3K API Worker',
	});

	const PER_PAGE = 100;

	const issues = [];
	if (updated_at != 0) {
		// YYYY-MM-DDTHH:MM:SSZ
		const d = new Date((updated_at - 35) * 1000); // Minus 35 seconds. D1 can sometimes timeout and the timeouts are around 30-32 seconds long
		const year = d.getUTCFullYear();
		const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
		const day = d.getUTCDate().toString().padStart(2, '0');
		const hours = d.getUTCHours().toString().padStart(2, '0');
		const mins = d.getUTCMinutes().toString().padStart(2, '0');
		const seconds = d.getUTCSeconds().toString().padStart(2, '0');
		const since = `${year}-${month}-${day}T${hours}:${mins}:${seconds}Z`;

		let shouldGetMore = true;
		let i = 1;
		while (shouldGetMore) {
			const r = await (octokit.request('GET /repos/{owner}/{repo}/issues',
				{
					owner: owner,
					repo: repo,
					state: 'all',
					sort: 'updated',
					page: i++,
					per_page: PER_PAGE,
					since: since
				}).then((v) => {
					return v.data;
				}));

			if (!Array.isArray(r)) {
				console.error("Github issue list is not an array.");
				throw new Error("Issue page is not an array: " + r);
			}

			const filteredIssues = r.filter((i) => typeof i.pull_request == 'undefined');
			issues.push(...filteredIssues);
			if (r.length != PER_PAGE) {
				// we got less issues this page, so this is the last one
				shouldGetMore = false;
			}
		}

		LOG(`${issues.length} Issues had activity in ${owner}/${repo} since ${since}`);
	} else {
		LOG(`timestamp for list ${owner}/${repo} is 0, getting all issues...`);
		// update_at is 0, so that means most likely the list is empty, get all pages of all open issues
		// and even if there is some entries in the list, they will get deleted anyways

		const repoInfo = await octokit.request('GET /repos/{owner}/{repo}', {
			owner: owner,
			repo: repo
		});

		const numberOfEntries = repoInfo.data.open_issues_count;
		const numberOfPages = Math.ceil(numberOfEntries / PER_PAGE);

		const fetches = Array.from({ length: numberOfPages }, (_, i) =>
			octokit.request('GET /repos/{owner}/{repo}/issues', {
				owner,
				repo,
				state: 'open',
				page: i + 1,
				per_page: PER_PAGE
			}).then((v) => v.data)
		);

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
  `owner` varchar(64) NOT NULL, \
  `repo` varchar(64) NOT NULL, \
  `timestamp` INTEGER NOT NULL DEFAULT 0 \
)').run();
}

async function createListSchema(env: Env) {
	return await env.DB.prepare(
		'CREATE TABLE `list` ( \
  `type` varchar(64) NOT NULL, \
  `name` varchar(1024) DEFAULT NULL, \
  `titleId` varchar(10) DEFAULT NULL, \
  `labels` TEXT DEFAULT NULL, \
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
		['commercial', { owner: 'Vita3K', repo: 'compatibility' }]
	] as const;

	for (const entry of repos) {
		batch.push(env.DB.prepare(
			'INSERT INTO `list_info` (`name`, `owner`, `repo`) VALUES (?, ?, ?)'
		).bind(entry[0], entry[1].owner, entry[1].repo));
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
		listExists
	] = await Promise.all([
		tableExists(env, 'list_info'),
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