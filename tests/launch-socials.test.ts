import {expect,test} from 'bun:test';
import {normalizeX,validX,xLink} from '../lib/launch-socials';
import {launchInput} from '../src/shared/domain';
test('optional X fields accept copied profile, community and post links on both client and server',()=>{
 for(const input of ['', '   ', '@launchseeds', 'launchseeds', 'https://x.com/launchseeds/?s=21', 'https://mobile.twitter.com/launchseeds', 'https://x.com/i/communities/1234567890123456789', 'https://x.com/i/communities/1234567890123456789/?s=21#about', 'https://twitter.com/launchseeds/status/1234567890123456789']){
  expect(validX(input)).toBe(true);
  expect(launchInput.shape.x.parse(input)).toBe(normalizeX(input));
 }
});
test('X validation rejects malformed names and deceptive links',()=>{
 for(const input of ['invalid username','https://x.com.evil.example/launchseeds','https://evil.example/x.com/launchseeds','javascript:alert(1)','https://evil@x.com/launchseeds','https://x.com/','https://x.com/i/communities/nope']){
  expect(validX(input)).toBe(false);expect(launchInput.shape.x.safeParse(input).success).toBe(false);
 }
});

test("token social links keep full X URLs without adding a second hostname",()=>{expect(xLink("@launchseeds")).toBe("https://x.com/launchseeds");expect(xLink("https://x.com/i/communities/123")).toBe("https://x.com/i/communities/123");expect(xLink("javascript:alert(1)")).toBe("")});
