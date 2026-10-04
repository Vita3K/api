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
		if (env.DISABLE_CACHE !== "true") {
			let cachedResponse = await cache.match(cacheKey);

			if (cachedResponse) {
				return cachedResponse;
			}
		}
		const result = await router(env, request);

		if (result.response.status == 200 && result.cache && env.DISABLE_CACHE !== "true") {
			result.response.headers.append("Cache-Control", "public, s-maxage=86400"); // 1 Day
			ctx.waitUntil(cache.put(cacheKey, result.response.clone()));
		}

		return result.response;
	},

	async scheduled(event, env, ctx) {
		switch (event.cron) {
			case '0 * * * *': { // Every hour
				const request = await fetch('http://fus01.psp2.update.playstation.net/update/psp2/list/us/psp2-updatelist.xml');

				const response = await request.text();

				if (request.status != 200) {
					console.warn(`Could not get firmware list, response was ${request.status} ${request.statusText}: ${response}`);
					return;
				}

				await env.DB.prepare('INSERT OR REPLACE INTO firmware (`id`, `response`) VALUES (1, ?)').bind(response).run();

				break;
			}
			case '*/1 * * * *': { // Every minute
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
				break;
			}
			default: {
				console.error(`Unknown cron ${event.cron}`);
				throw `Unknown cron ${event.cron}`;
			}
		}
	}
} satisfies ExportedHandler<Env>;
