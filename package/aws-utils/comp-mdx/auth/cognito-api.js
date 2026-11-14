// The public api of an Amazon Cognito user pool, called from the browser (contract:
// doc/auth-contract.md#signing-in-inside-the-page). Cognito answers these calls to any origin, so
// a form inside the page signs a person in without a redirect and without code of ours between
// the password and Cognito. Nothing here keeps state: the session is the auth layer's.
//
// every call answers { code, message, data }: code 0 with the json Cognito answered as data; -1
// with what Cognito refused (data.errorType: its exception, NotAuthorizedException ...); -9 when
// Cognito was not reached.

const CODE_UNREACHABLE = -9;

export async function cognitoCall(region, target, body) {
  let response;
  try {
    response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    return { code: CODE_UNREACHABLE, message: `Cognito was not reached (${String(error?.message ?? error)})`, data: { errorType: '' } };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorType = String(payload?.__type ?? '').split('#').pop();
    return { code: -1, message: messageOfErrorGet(errorType, String(payload?.message ?? '')), data: { errorType } };
  }
  return { code: 0, message: '', data: payload };
}

// what a person reads for an exception of Cognito: its own message is kept where it says more
function messageOfErrorGet(errorType, message) {
  switch (errorType) {
    case 'NotAuthorizedException': return message || 'The user name or the password is not right.';
    case 'UserNotFoundException': return 'The user name or the password is not right.';
    case 'PasswordResetRequiredException': return 'The password of this account was reset: the email of the account has a code to choose a new one with.';
    case 'SoftwareTokenMFANotFoundException': return 'The user pool does not take authenticator apps yet: its MFA setting is off. The owner of the deployment turns it on (the block mfa of the pool, then the ensure script of the auth backend).';
    case 'UserNotConfirmedException': return 'This account is not confirmed yet.';
    case 'CodeMismatchException': return 'The code is not right.';
    case 'ExpiredCodeException': return 'The code is too old: ask for a new one.';
    case 'EnableSoftwareTokenMFAException': return 'The code is not right: the authenticator app was not turned on.';
    case 'InvalidPasswordException': return message || 'The password does not meet the rules of the user pool.';
    case 'LimitExceededException':
    case 'TooManyRequestsException': return 'Too many attempts: wait a while and try again.';
    default: return message || errorType || 'Cognito refused the request.';
  }
}

// ---------- signing in ----------

// user name and password. data: { tokens } when signed in, or { challenge: { name, session, userName, parameters } }
export async function cognitoSignIn(config, userName, password) {
  const result = await cognitoCall(config.region, 'InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH', ClientId: config.clientId, AuthParameters: { USERNAME: userName, PASSWORD: password },
  });
  return authAnswerRead(result, userName);
}

// the answer to a challenge: NEW_PASSWORD_REQUIRED ({ NEW_PASSWORD }), SOFTWARE_TOKEN_MFA ({ SOFTWARE_TOKEN_MFA_CODE })
export async function cognitoChallengeAnswer(config, challenge, responseMap) {
  const result = await cognitoCall(config.region, 'RespondToAuthChallenge', {
    ChallengeName: challenge.name, ClientId: config.clientId, Session: challenge.session,
    ChallengeResponses: { USERNAME: challenge.userName, ...responseMap },
  });
  return authAnswerRead(result, challenge.userName);
}

function authAnswerRead(result, userName) {
  if (result.code !== 0) return result;
  const answer = result.data;
  if (answer.AuthenticationResult) return { code: 0, data: { tokens: tokensRead(answer.AuthenticationResult) }, message: '' };
  if (answer.ChallengeName) {
    const parameters = answer.ChallengeParameters ?? {};
    return {
      code: 0, message: '',
      data: { challenge: { name: answer.ChallengeName, session: answer.Session, userName: parameters.USER_ID_FOR_SRP || parameters.USERNAME || userName, parameters } },
    };
  }
  return { code: -1, data: null, message: 'Cognito answered neither tokens nor a challenge.' };
}

// the tokens of a session, with when the access token ends (ms)
function tokensRead(authenticationResult, refreshTokenBefore = '') {
  const accessToken = authenticationResult.AccessToken ?? '';
  const claims = jwtClaimsRead(accessToken);
  return {
    accessToken,
    idToken: authenticationResult.IdToken ?? '',
    refreshToken: authenticationResult.RefreshToken || refreshTokenBefore,
    timeExpire: claims.exp ? claims.exp * 1000 : Date.now() + Number(authenticationResult.ExpiresIn ?? 3600) * 1000,
  };
}

// new access and id tokens from the refresh token. data.errorType NotAuthorizedException: the
// refresh token is not good any more (revoked, expired, the user disabled): the session has ended
export async function cognitoRefresh(config, tokens) {
  const result = await cognitoCall(config.region, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: config.clientId, AuthParameters: { REFRESH_TOKEN: tokens.refreshToken },
  });
  if (result.code !== 0) return result;
  if (!result.data.AuthenticationResult) return { code: -1, message: 'Cognito did not refresh the session.', data: { errorType: '' } };
  return { code: 0, data: { tokens: tokensRead(result.data.AuthenticationResult, tokens.refreshToken) }, message: '' };
}

// the refresh token ended at Cognito, with the tokens made from it
export function cognitoSignOut(config, tokens) {
  return cognitoCall(config.region, 'RevokeToken', { Token: tokens.refreshToken, ClientId: config.clientId });
}

// ---------- the password ----------

export const cognitoPasswordForgot = (config, userName) => cognitoCall(config.region, 'ForgotPassword', { ClientId: config.clientId, Username: userName });

export const cognitoPasswordForgotConfirm = (config, userName, code, password) => (
  cognitoCall(config.region, 'ConfirmForgotPassword', { ClientId: config.clientId, Username: userName, ConfirmationCode: code, Password: password })
);

export const cognitoPasswordChange = (config, accessToken, passwordBefore, passwordNext) => (
  cognitoCall(config.region, 'ChangePassword', { AccessToken: accessToken, PreviousPassword: passwordBefore, ProposedPassword: passwordNext })
);

// ---------- the authenticator app (TOTP) ----------

// the user as the pool knows it: { userName, attributeByName, isMfaEnabled }
export async function cognitoUserGet(config, accessToken) {
  const result = await cognitoCall(config.region, 'GetUser', { AccessToken: accessToken });
  if (result.code !== 0) return result;
  const attributeByName = Object.fromEntries((result.data.UserAttributes ?? []).map((one) => [one.Name, one.Value]));
  return {
    code: 0, message: '',
    data: { userName: result.data.Username ?? '', attributeByName, isMfaEnabled: (result.data.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA') },
  };
}

// a new secret for an authenticator app: { secret }
export async function cognitoMfaBegin(config, accessToken) {
  const result = await cognitoCall(config.region, 'AssociateSoftwareToken', { AccessToken: accessToken });
  return result.code === 0 ? { code: 0, data: { secret: result.data.SecretCode ?? '' }, message: '' } : result;
}

// the first code of the app proves it holds the secret; MFA is then asked at every sign-in
export async function cognitoMfaConfirm(config, accessToken, code, deviceName = 'authenticator app') {
  const verified = await cognitoCall(config.region, 'VerifySoftwareToken', { AccessToken: accessToken, UserCode: code, FriendlyDeviceName: deviceName });
  if (verified.code !== 0) return verified;
  if (verified.data.Status !== 'SUCCESS') return { code: -1, message: 'The code is not right.', data: { errorType: '' } };
  return cognitoCall(config.region, 'SetUserMFAPreference', { AccessToken: accessToken, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
}

// what an authenticator app reads from a QR code: otpauth://totp/{issuer}:{user}?secret=…&issuer=…
export function cognitoMfaUriBuild(secret, userName, issuer) {
  const labelText = `${issuer}:${userName}`;
  return `otpauth://totp/${encodeURIComponent(labelText)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}`;
}

// ---------- tokens ----------

// the claims of a jwt, unchecked: the page reads them to show who is signed in; whoever trusts a
// token (API Gateway) checks its signature
export function jwtClaimsRead(token) {
  try {
    const part = String(token ?? '').split('.')[1] ?? '';
    const text = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return JSON.parse(decodeURIComponent([...text].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
  } catch {
    return {};
  }
}

// who a session is, from its tokens: the id token says the name and the email, the access token the
// groups of the user pool, which are the roles of the account to the auth layer
export function identityOfTokensGet(tokens) {
  const claimsId = jwtClaimsRead(tokens?.idToken);
  const claimsAccess = jwtClaimsRead(tokens?.accessToken);
  const groupList = claimsAccess['cognito:groups'] ?? claimsId['cognito:groups'] ?? [];
  return {
    subject: String(claimsAccess.sub ?? claimsId.sub ?? ''),
    userName: String(claimsAccess.username ?? claimsId['cognito:username'] ?? ''),
    name: String(claimsId.name ?? ''),
    email: String(claimsId.email ?? ''),
    roleList: Array.isArray(groupList) ? groupList.map(String) : [],
  };
}
