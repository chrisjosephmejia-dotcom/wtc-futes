import test from "node:test";
import assert from "node:assert/strict";
import {
 nyseCashSessionMinutes,
 nyseSessionEquivalentsUntil,
 nyseTodayRemainingFraction,
 CASH_MINUTES_PER_SESSION
} from "../netlify/functions/lib/nyse-sessions.mts";

test("2026 Thanksgiving is closed, Black Friday is a 3.5-hour half day",()=>{
 assert.equal(nyseCashSessionMinutes("2026-11-26"),0);
 assert.equal(nyseCashSessionMinutes("2026-11-27"),210);
 assert.equal(nyseCashSessionMinutes("2026-11-30"),390);
});
test("Wednesday November 25 through Friday Dec 4 excludes Thanksgiving closure and weights Black Friday",()=>{
 const sessions=nyseSessionEquivalentsUntil("2026-11-25","2026-12-04");
 assert.equal(sessions,5+210/390);
 const remaining=nyseTodayRemainingFraction("2026-11-25",11*60+57);
 assert.ok(Math.abs(sessions+remaining-6.0077)<.001);
 assert.equal(CASH_MINUTES_PER_SESSION,390);
});
test("2026 Christmas Eve is shortened and Christmas closed",()=>{
 assert.equal(nyseCashSessionMinutes("2026-12-24"),210);
 assert.equal(nyseCashSessionMinutes("2026-12-25"),0);
});
test("2027 and 2028 NYSE schedule honors observed days and holiday early closes",()=>{
 assert.equal(nyseCashSessionMinutes("2027-12-24"),0);
 assert.equal(nyseCashSessionMinutes("2027-11-26"),210);
 assert.equal(nyseCashSessionMinutes("2028-07-03"),210);
 assert.equal(nyseCashSessionMinutes("2028-07-04"),0);
});
test("elapsed session time and closed holidays never contribute to time horizon",()=>{
 assert.equal(nyseTodayRemainingFraction("2026-11-26",11*60+30),0);
 assert.equal(nyseTodayRemainingFraction("2026-11-27",12*60),0);
 assert.equal(nyseTodayRemainingFraction("2026-11-27",11*60),60/390);
 assert.equal(nyseTodayRemainingFraction("2026-11-27",7*60),210/390);
});
