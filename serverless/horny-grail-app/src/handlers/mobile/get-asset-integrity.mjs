import { buildAssetIntegrityResponse } from '../assets/get-asset-integrity.mjs';
import { requireMobileReadToken } from '../../lib/auth.mjs';
import { corsPreflight } from '../../lib/http.mjs';

export const getMobileAssetIntegrityHandler = async (event) => {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  if (method === 'OPTIONS') {
    return corsPreflight(event);
  }

  const authError = requireMobileReadToken(event);
  if (authError) {
    return authError;
  }

  return buildAssetIntegrityResponse(event?.pathParameters?.id, event);
};
