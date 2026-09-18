import { PROVIDER_META, type ProviderId } from '../../../../agent/providers/defaults';
export { HELP_SURFACES } from './figures/surfaces';
export const helpProvider = (id: ProviderId) => PROVIDER_META[id];
export { PROVIDER_IDS, providerBaseUrls } from '../../../../agent/providers/defaults';
