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
