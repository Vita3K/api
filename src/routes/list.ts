import { Env, GameEntry, ListInfo } from '../types';

export default async function (env: Env, req: Request, match: URLPatternResult): Promise<Response> {
	if (req.method != 'GET') {
		return Response.json('Method not allowed', { status: 405 });
	}

	if (typeof match.pathname.groups == 'undefined' || typeof match.pathname.groups.type == 'undefined') {
		return Response.json('invalid list type', { status: 400 });
	}

	const [listInfosResult, listResult] = await env.DB.batch([
		env.DB.prepare('SELECT * FROM list_info'),
		// even if the list is invalid, this will return an empty list
		env.DB.prepare('SELECT `name`,`titleId`,`labels`,`issueId` FROM list WHERE type = ?').bind(match.pathname.groups.type)
	]);

	const listInfos = listInfosResult.results as ListInfo[];
	const list = listResult.results;

	const listInfo = listInfos.find((l) => l.name == match.pathname.groups.type);
	if (typeof listInfo == 'undefined')
		return Response.json('invalid list type', { status: 400 });

	return new Response(JSON.stringify({ date: listInfo.timestamp, list: list }), {
		status: 200, headers: {
			'content-type': 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		}
	});
}
