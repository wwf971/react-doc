// The client of the account service (contract: doc/auth-contract.md#the-account-service): the
// backend beside a Cognito user pool through which an account admin issues, changes and revokes
// accounts, a person asks for one, and a signed-in person reads who they are to our services.
//
// every call answers { code, message, data } and nothing else at the top level, with the codes of
// the contract; -9 when the service was not reached. an answer AWS gives itself (a 401 of the
// authorizer, a 429) is turned into that shape here. token: the access token of the session (the auth layer's credential).

const CODE_AUTH_REQUIRED = -7;
const CODE_UNREACHABLE = -9;

async function accountCall(config, method, route, { body, token } = {}) {
  const url = String(config?.accountApiUrl ?? '').replace(/\/+$/, '');
  if (!url) return { code: -1, data: null, message: 'the auth provider names no account service (metadata.auth.accountApiUrl)' };
  const headerMap = {};
  if (token) headerMap.Authorization = `Bearer ${token}`;
  const init = { method, headers: headerMap, cache: 'no-store' };
  if (method === 'POST') {
    headerMap['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let response;
  try {
    response = await fetch(`${url}${route}`, init);
  } catch (error) {
    return { code: CODE_UNREACHABLE, data: null, message: `the account service was not reached (${String(error?.message ?? error)})` };
  }
  const payload = await response.json().catch(() => undefined);
  if (!payload || typeof payload.code !== 'number') {
    // an answer AWS gave itself, before the code of the service ran: turned into the one shape by its status
    if (response.status === 401) return { code: CODE_AUTH_REQUIRED, message: 'the account service did not accept the session: sign in again', data: null };
    if (response.status === 403) return { code: -8, message: 'the account service refused the request', data: null };
    if (response.status === 429) return { code: -10, message: 'too many requests: wait a while and try again', data: null };
    return { code: -1, message: `the account service answered ${response.status} without a result`, data: null };
  }
  return { code: payload.code, message: String(payload.message ?? ''), data: payload.data ?? null };
}

// ---------- for everyone ----------

export const accountStatusGet = (config) => accountCall(config, 'GET', '/status');

export const accountRegisterRequest = (config, { email, name, note }) => accountCall(config, 'POST', '/register/request', { body: { email, name, note } });

// ---------- for a signed-in person ----------

export const accountMeGet = (config, token) => accountCall(config, 'GET', '/me', { token });

export const accountMeNameSet = (config, token, name) => accountCall(config, 'POST', '/me/name/set', { token, body: { name } });

// ---------- for an account admin ----------

export const accountAdminGet = (config, token, route) => accountCall(config, 'GET', `/admin/${route}`, { token });

export const accountAdminPost = (config, token, route, body) => accountCall(config, 'POST', `/admin/${route}`, { token, body });
