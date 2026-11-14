import { compDefine } from '../../../../main/comp-doc/registry/comp-registry.js';
import { AwsAuthAdmin } from './AwsAuthAdmin.jsx';
import { AwsAuthSession } from './AwsAuthSession.jsx';

// The modes of a Cognito auth provider (doc/README.md#the-auth-provider): modes of a frontend
// object, rendered by the entry component ObjectFrontend, never written as blocks themselves.
const modeDefine = (label, description) => ({ placementList: ['objectFrontend'], expose: { meta: { label, description, isNotInDoc: true } } });

export const AwsAuthSessionDefine = compDefine(AwsAuthSession, modeDefine('Auth provider: session', 'Who is signed in to a Cognito auth provider, and what a person does with their own account.'));
export const AwsAuthAdminDefine = compDefine(AwsAuthAdmin, modeDefine('Auth provider: account admin', 'The console of the account admin: accounts issued, changed and revoked, requests for an account.'));
