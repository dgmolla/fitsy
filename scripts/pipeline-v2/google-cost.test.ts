import { fetchGooglePlacesPhoto } from '../../apps/api/services/googlePlacesPhoto';

const priorKey = process.env['GOOGLE_PLACES_API_KEY'];
const http = jest.spyOn(global,'fetch');
beforeEach(()=> { process.env['GOOGLE_PLACES_API_KEY']='fixture-private-google-key'; http.mockReset(); });
afterAll(()=> { http.mockRestore(); if (priorKey===undefined) delete process.env['GOOGLE_PLACES_API_KEY']; else process.env['GOOGLE_PLACES_API_KEY']=priorKey; });
const search = () => Response.json({ places:[{ location:{ latitude:34.05,longitude:-118.25 },photos:[{ name:'places/place/photos/image' }] }] });

test('each Google HTTP call awaits its full price envelope and reports a response before the next admission', async () => {
  const order:string[]=[];
  http.mockImplementation(async input => { order.push(String(input).includes('searchText')?'search':'photo'); return order.at(-1)==='search'?search():Response.json({ photoUri:'https://example.test/image' }); });
  const result = await fetchGooglePlacesPhoto('Fixture',34.05,-118.25,{
    beforeRequest:async usd=>{ order.push(`reserve:${usd}`); },onResponse:status=>{ order.push(`settle:${status}`); },
  });
  expect(result).toBe('https://example.test/image');
  expect(order).toEqual(['reserve:0.032','search','settle:200','reserve:0.007','photo','settle:200']);
});

test('a rejected photo reservation propagates as a cap stop and never sends photo transport', async () => {
  http.mockResolvedValue(search());
  await expect(fetchGooglePlacesPhoto('Fixture',34.05,-118.25,{
    beforeRequest:usd=> { if (usd===0.007) throw new Error('cap reached'); },onResponse:()=>{},
  })).rejects.toThrow('cap reached');
  expect(http).toHaveBeenCalledTimes(1);
});

test.each([403,429,500])('failed Google HTTP %i retains the attempted-call bound and exposes throttle status', async status => {
  http.mockResolvedValue(new Response('',{ status })); const observed:number[]=[];
  expect(await fetchGooglePlacesPhoto('Fixture',34.05,-118.25,{ beforeRequest:()=>{},onResponse:code=>{ observed.push(code!); } })).toBeNull();
  expect(observed).toEqual([status]); expect(http).toHaveBeenCalledTimes(1);
});

test('uncertain transport is accounted conservatively and never automatically retried', async () => {
  http.mockRejectedValue(new Error('transport lost')); const settle = jest.fn();
  expect(await fetchGooglePlacesPhoto('Fixture',34.05,-118.25,{ beforeRequest:()=>{},onResponse:settle })).toBeNull();
  expect(settle).toHaveBeenCalledTimes(1); expect(http).toHaveBeenCalledTimes(1);
});

test('no Google credential means no reservation or transport', async () => {
  delete process.env['GOOGLE_PLACES_API_KEY']; const reserve = jest.fn();
  expect(await fetchGooglePlacesPhoto('Fixture',34.05,-118.25,{ beforeRequest:reserve,onResponse:()=>{} })).toBeNull();
  expect(reserve).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
});
