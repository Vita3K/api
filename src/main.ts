import { router } from './route';
import { GetGithubIssues, } from './utils';
import { Env, ListInfo } from './types';

export default {
	async fetch(request, env, ctx) {
		if (env.ACCESS_TOKEN == null || typeof env.ACCESS_TOKEN == 'undefined')
			throw 'ACCESS_TOKEN IS NEEDED';

		// Construct the cache key from the cache URL
		const cache = caches.default;
		const cacheKey = new Request(request.url);

		let cachedResponse = await cache.match(cacheKey);

		if (cachedResponse) {
			return cachedResponse;
		}

		const result = await router(env, request);

		if (result.cache) {
			result.response.headers.append("Cache-Control", "s-maxage=3600");
			ctx.waitUntil(cache.put(cacheKey, result.response.clone()));
		}

		return result.response;
	},

	// We only have 1 cronjob so we can just run the thing, no need to check for anything
	async scheduled(event, env, ctx) {
		if (env.ACCESS_TOKEN == null || typeof env.ACCESS_TOKEN == 'undefined')
			throw 'ACCESS_TOKEN IS NEEDED';

		const listInfosResult = await env.DB.prepare('SELECT * FROM list_info').run<ListInfo>();
		const listInfos = listInfosResult.results;


		// Update the list of every list in the list_info table
		for (const list of listInfos) {
			const ghIssues = await GetGithubIssues(env.ACCESS_TOKEN, list.owner, list.repo, list.timestamp);

			if (ghIssues.length == 0)
				return; // There was no activity in the list since last time

			const updateBatch: D1PreparedStatement[] = [];
			// Delete issues that updated
			// Only delete issues if the last was updated at least once, else there wouldnt be any
			if (list.timestamp != 0)
				ghIssues.forEach((i) => {
					updateBatch.push(env.DB.prepare('DELETE FROM list WHERE issueId = ? AND type = ?').bind(i.number, list.name));
				});

			const regexp = new RegExp(`^(?<title>.*) \\[(?<id>.*)\\]$`);
			ghIssues.forEach((issue) => {
				if (issue.state != 'open')
					return;
				const matches = regexp.exec(issue.title);
				let title = issue.title;
				let titleId = 'INVALID';
				if (matches && matches.groups) {
					title = matches.groups.title;
					titleId = matches.groups.id;
				}

				const labels = issue.labels?.map((v) => {
					if (typeof v === 'string') {
						return { name: v, color: '000000' };
					}

					return {
						name: v.name ?? 'Unknown',
						color: v.color ?? '000000'
					};
				}) ?? [];

				updateBatch.push(env.DB.prepare('INSERT INTO list (`type`,`name`,`titleId`,`labels`,`issueId`) VALUES (?,?,?,?,?)')
					.bind(list.name, title, titleId, JSON.stringify(labels), issue.number));
			});
			if (updateBatch.length > 0) {
				await env.DB.batch(updateBatch);
			}
		}
	}
} satisfies ExportedHandler<Env>;
