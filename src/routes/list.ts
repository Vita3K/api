import { Env, GameEntry, ListInfo } from '../types';

export default async function (env: Env, req: Request, match: URLPatternResult): Promise<Response> {
	if (req.method != 'GET') {
		return Response.json('Method not allowed', { status: 405 });
	}

	if (typeof match.pathname.groups == 'undefined' || typeof match.pathname.groups.type == 'undefined') {
		return Response.json('invalid list type', { status: 400 });
	}

	const [listInfosResult, listResult] = await env.DB.batch([
		env.DB.prepare('SELECT `timestamp` FROM list_info WHERE name = ?').bind(match.pathname.groups.type),
		// even if the list is invalid, this will return an empty list
		env.DB.prepare('SELECT `name`,`titleId`,`labels`,`issueId` FROM list WHERE type = ?').bind(match.pathname.groups.type)
	]) as [D1Result<Pick<ListInfo, 'timestamp'>>, D1Result<GameEntry>];

	const listInfo = listInfosResult.results;

	if (listInfo.length == 0)
		return Response.json('invalid list', { status: 400 });
	const timestamp = listInfo[0].timestamp;

	const list = listResult.results;

	return new Response(JSON.stringify({
		date: timestamp,
		list: list
	}), {
		status: 200, headers: {
			'content-type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		}
	});
}
