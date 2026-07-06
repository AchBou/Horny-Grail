import { buildAssetIntegrityResponse } from '../assets/get-asset-integrity.mjs';
import { requireMobileReadToken } from '../../lib/auth.mjs';
import { guardRequest } from '../../lib/request-guards.mjs';

export const getMobileAssetIntegrityHandler = async (event) => {
  const guardError = guardRequest(event, {
    handlerName: 'getMobileAssetIntegrity',
    method: 'GET',
    allowOptions: true,
    authorize: requireMobileReadToken
  });
  if (guardError) {
    return guardError;
  }

  return buildAssetIntegrityResponse(event?.pathParameters?.id, event);
};
