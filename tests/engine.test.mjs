import test from 'node:test';
import assert from 'node:assert/strict';
import {ema,hybrid,kingWeekly,centurionDaily} from '../lib/engine.mjs';
test('constant EMA seed',()=>assert.equal(ema(Array(280).fill(10),270),10));
test('insufficient history cannot verify',()=>assert.equal(hybrid([1,2,3],'BEARISH').verified,false));
test('EMA bearish overrides King',()=>{
  const a=Array(270).fill(100);for(let i=190;i<270;i++)a[i]=50;
  assert.equal(hybrid(a,'BULLISH').target,'CASH');
});
test('EMA bullish respects King',()=>{
  const a=Array(270).fill(100);for(let i=190;i<270;i++)a[i]=180;
  assert.equal(hybrid(a,'BEARISH').target,'QQQ');
  assert.equal(hybrid(a,'BULLISH').target,'TQQQ');
});
test('King weekly 4 percent reverse',()=>{
  const r=kingWeekly([{date:'2026-08-14',close:690}]);
  assert.equal(r.mode,'BEARISH');
});
test('Centurion emergency exit',()=>{
  const r=centurionDaily([{date:'2026-10-16',credit:false,volatility:false,breadth:true,trend:true,utilities:true}],{initialMode:'ON',initialSmoothed:.8,held:1});
  assert.equal(r[0].mode,'OFF');assert.equal(r[0].target,'TREASURY_BILL_ETF');
});
