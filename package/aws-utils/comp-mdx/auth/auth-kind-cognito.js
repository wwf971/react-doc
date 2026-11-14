import { cognitoRefresh, cognitoSignOut, identityOfTokensGet } from './cognito-api.js';
import { AuthSignInModel } from './AuthSignInModel.js';
import { AuthSignIn } from './AuthSignIn.jsx';

// The auth kind cognito (contract: doc/auth-contract.md; what a kind is: react-doc
// main/doc_page_impl_auth.md#auth-kinds-of-a-package). The auth layer of the page calls it for a
// provider of the type aws-utils.auth-cognito: to read the config of the provider, to check and
// refresh what the browser kept of a session, to end one, and to draw the sign-in dialog.
//
// the data of a session of this kind is its tokens: { accessToken, idToken, refreshToken,
// timeExpire }. A consumer is given the access token only.

// the access token is refreshed when it has less than this left (ms)
const REFRESH_MARGIN = 2 * 60 * 1000;

const REGION_REGEX = /^[a-z]{2}(-[a-z]+)+-\d+$/;

export const authKindCognito = {
  // the config of a provider, from metadata.auth of its object: { region, userPoolId, clientId, accountApiUrl? }
  configRead(metadataAuth) {
    const source = metadataAuth && typeof metadataAuth === 'object' ? metadataAuth : {};
    const config = {
      region: String(source.region ?? '').trim(),
      userPoolId: String(source.userPoolId ?? '').trim(),
      clientId: String(source.clientId ?? '').trim(),
      accountApiUrl: String(source.accountApiUrl ?? '').trim().replace(/\/+$/, ''),
    };
    const missingList = ['region', 'userPoolId', 'clientId'].filter((key) => !config[key]);
    if (missingList.length > 0) {
      return { config, message: `the entry of the object names its user pool in metadata.auth: ${missingList.join(', ')} ${missingList.length > 1 ? 'are' : 'is'} missing` };
    }
    if (!REGION_REGEX.test(config.region)) return { config, message: `metadata.auth.region is an AWS region (us-east-1): ${config.region}` };
    if (!config.userPoolId.startsWith(`${config.region}_`)) return { config, message: `metadata.auth.userPoolId is a pool of the region ${config.region} (${config.region}_…): ${config.userPoolId}` };
    return { config, message: '' };
  },

  // what the browser kept is usable while it holds a refresh token: the access token is made anew
  sessionCheck({ data }) {
    if (!data?.refreshToken || !data?.accessToken) return { isUsable: false };
    return { isUsable: true, identity: identityOfTokensGet(data), timeExpire: Number(data.timeExpire) || 0 };
  },

  // the access token of the session, refreshed when it is about to end. isFresh: refreshed now,
  // whatever time it has left: a token says the groups its user had when it was made, so a
  // group given since is only in a new one
  async credentialGet({ config, data, isFresh = false }) {
    if (!data?.accessToken) return { code: -7, message: 'not signed in' };
    if (!isFresh && Number(data.timeExpire) - Date.now() > REFRESH_MARGIN) {
      return { code: 0, message: '', data: { token: data.accessToken, tokenType: 'Bearer', timeExpire: data.timeExpire } };
    }
    const refreshed = await cognitoRefresh(config, data);
    if (refreshed.code !== 0) {
      // Cognito says the refresh token is not good any more: the session ended
      const errorType = refreshed.data?.errorType ?? '';
      if (errorType === 'NotAuthorizedException' || errorType === 'UserNotFoundException') {
        return { code: -7, message: 'the session ended (it was revoked, or it is too old): sign in again' };
      }
      // Cognito was not reached: a token that still has time left is used as it is
      if (Number(data.timeExpire) > Date.now()) return { code: 0, message: '', data: { token: data.accessToken, tokenType: 'Bearer', timeExpire: data.timeExpire } };
      return { code: refreshed.code, message: refreshed.message };
    }
    const tokens = refreshed.data.tokens;
    // session: what the auth layer keeps from now on (the new tokens); it is not handed to the consumer
    return {
      code: 0, message: '',
      data: {
        token: tokens.accessToken, tokenType: 'Bearer', timeExpire: tokens.timeExpire,
        session: { data: tokens, identity: identityOfTokensGet(tokens), timeExpire: tokens.timeExpire },
      },
    };
  },

  async signOut({ config, data }) {
    if (data?.refreshToken) await cognitoSignOut(config, data);
  },

  signInModelCreate: ({ provider, authStore }) => new AuthSignInModel({ provider, authStore }),
  SignInComp: AuthSignIn,
};
