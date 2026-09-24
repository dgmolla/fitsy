import { act, waitFor } from '@testing-library/react-native';
import {
  deferred,
  mockRc,
  proInfo,
  renderProvider,
  setupPurchasesMocks,
  type Info,
} from './usePurchasesTestKit';

setupPurchasesMocks();

it('keeps a signed-in boot identity read after a stale native account update', async () => {
  const identity = deferred<Info>();
  const lapsedInfo: Info = { entitlements: { active: {}, all: { pro: {} } } };
  mockRc.identifyPurchasesUser.mockReturnValueOnce(identity.promise);
  mockRc.currentPurchasesUserId.mockResolvedValueOnce('previous-user');
  const { result } = renderProvider();
  await waitFor(() => expect(mockRc.identifyPurchasesUser).toHaveBeenCalledWith('u1'));
  const listener = mockRc.addCustomerInfoListener.mock.calls[0][0];
  await act(async () => { listener(proInfo); });
  expect(mockRc.fetchCustomerInfo).not.toHaveBeenCalled();
  await act(async () => { identity.resolve(lapsedInfo); });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.customerInfo).toEqual(lapsedInfo);
  expect(result.current.isLapsed).toBe(true);
});
