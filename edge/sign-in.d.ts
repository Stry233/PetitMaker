/** The variables the sign-in exchange reads. */
export interface SignInEnv {
  MODELSCOPE_CLIENT_ID?: string;
  MODELSCOPE_CLIENT_SECRET?: string;
  MODELSCOPE_REDIRECT_URI?: string;
  /** Comma-separated origins whose pages may call the exchange. */
  SIGN_IN_ALLOWED_ORIGINS?: string;
}
export const SIGN_IN_PATH: string;
export function handleSignIn(request: Request, env: SignInEnv, fetchFn: typeof fetch): Promise<Response>;
declare const routine: {
  fetch(request: Request, context: unknown, env: SignInEnv & { Assets?: { fetch(request: Request): Promise<Response> } }): Promise<Response>;
};
export default routine;
