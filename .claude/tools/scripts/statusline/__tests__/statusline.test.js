'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = path.resolve(__dirname, '..', 'statusline-command.cjs');
const {
  formatTokens,
  calcCacheRate,
  parseUsage,
  buildContextDisplay,
  buildDuration,
  lookupContextWindow,
} = require(MODULE);

// === formatTokens ===

function testFormatTokensZero() {
  assert.equal(formatTokens(0), '0');
}

function testFormatTokensSmall() {
  assert.equal(formatTokens(999), '999');
}

function testFormatTokensK() {
  assert.equal(formatTokens(1500), '1.5K');
  assert.equal(formatTokens(1000), '1.0K');
  assert.equal(formatTokens(9999), '10.0K');
}

function testFormatTokensM() {
  assert.equal(formatTokens(1_500_000), '1.5M');
  assert.equal(formatTokens(1_000_000), '1.0M');
}

function testFormatTokensInvalid() {
  assert.equal(formatTokens(undefined), '0');
  assert.equal(formatTokens(null), '0');
  assert.equal(formatTokens(NaN), '0');
  assert.equal(formatTokens(-100), '0');
  assert.equal(formatTokens('500'), '0'); // strings rejected
}

// === calcCacheRate ===
//
// 命中率 = cache_read / (cache_read + input)。
// input 是未命中部分（Anthropic API 把 input/cached/cache_creation 三者分开计），
// 不再用 cache_creation 当分母（cache_creation 几乎永远是 0，会让结果恒等于 100%）。

function testCalcCacheRateZeroDenominator() {
  // No input-side tokens → null (avoids meaningless "0%")
  assert.equal(calcCacheRate({ cache_read: 0, input: 0 }), null);
  assert.equal(calcCacheRate({}), null);
  assert.equal(calcCacheRate(null), null);
}

function testCalcCacheRateAllHit() {
  // input=0 表示全部命中
  assert.equal(calcCacheRate({ cache_read: 100, input: 0 }), 100);
}

function testCalcCacheRateAllMiss() {
  // cache_read=0 表示全部未命中
  assert.equal(calcCacheRate({ cache_read: 0, input: 100 }), 0);
}

function testCalcCacheRateMixed() {
  assert.equal(calcCacheRate({ cache_read: 80, input: 20 }), 80);
  assert.equal(calcCacheRate({ cache_read: 33, input: 67 }), 33);
}

function testCalcCacheRateRounding() {
  // 1/3 ≈ 33.33 → 33
  assert.equal(calcCacheRate({ cache_read: 1, input: 2 }), 33);
  // 2/3 ≈ 66.67 → 67
  assert.equal(calcCacheRate({ cache_read: 2, input: 1 }), 67);
}

// === parseUsage ===

function testParseUsageEmpty() {
  assert.deepEqual(parseUsage([]), { input: 0, output: 0, cache_read: 0, cache_creation: 0 });
  assert.deepEqual(parseUsage(null), { input: 0, output: 0, cache_read: 0, cache_creation: 0 });
}

function testParseUsageAggregate() {
  const lines = [
    JSON.stringify({ tokens: { input: 100, output: 50, cache_read: 10, cache_creation: 5 } }),
    JSON.stringify({ tokens: { input: 200, output: 80, cache_read: 20, cache_creation: 10 } }),
  ];
  const agg = parseUsage(lines);
  assert.equal(agg.input, 300);
  assert.equal(agg.output, 130);
  assert.equal(agg.cache_read, 30);
  assert.equal(agg.cache_creation, 15);
}

function testParseUsageSkipsBadLines() {
  const lines = [
    JSON.stringify({ tokens: { input: 100 } }),
    'not valid json',
    '',
    JSON.stringify({ tokens: { input: 200 } }),
    '{ broken',
  ];
  const agg = parseUsage(lines);
  assert.equal(agg.input, 300); // only the 2 valid lines
}

function testParseUsageMissingTokensField() {
  const lines = [
    JSON.stringify({ role: 'developer' }), // no tokens field
    JSON.stringify({ tokens: { input: 50 } }),
  ];
  const agg = parseUsage(lines);
  assert.equal(agg.input, 50);
}

function testParseUsageLimit() {
  // Generate 300 lines; only the last 200 should be summed.
  const lines = [];
  for (let i = 0; i < 300; i++) {
    lines.push(JSON.stringify({ tokens: { input: 1 } }));
  }
  const agg = parseUsage(lines, 200);
  assert.equal(agg.input, 200);
}

function testParseUsageDefaultLimit() {
  // Default limit=200
  const lines = [];
  for (let i = 0; i < 250; i++) {
    lines.push(JSON.stringify({ tokens: { input: 1 } }));
  }
  const agg = parseUsage(lines);
  assert.equal(agg.input, 200);
}

// === buildContextDisplay ===
//
// 新逻辑：按 model.id 查 MODEL_CONTEXT_WINDOWS 真实 size（payload 写死 200K 不分模型）。
// usedTokens 优先用 total_input_tokens（当前窗口占用）；缺失时回退 used_percentage × realSize。

function testContextDisplayMissing() {
  assert.equal(buildContextDisplay(null, 'glm-5.2'), '');
  assert.equal(buildContextDisplay({}, 'glm-5.2'), '');
  assert.equal(buildContextDisplay({ used_percentage: null }, 'glm-5.2'), '');
  assert.equal(buildContextDisplay({ context_window_size: 0 }, 'unknown-model'), '');
}

// glm-5.2 实际是 1M 窗口。Claude Code payload 写死 200K，导致失真。
// 修复后应显示 ctx:80K/1M(8%)（基于真实 size 1_000_000 重算）
function testContextDisplayKnownModelUsesMapping() {
  const out = buildContextDisplay(
    { total_input_tokens: 80000, context_window_size: 200000, used_percentage: 40 },
    'glm-5.2'
  );
  assert.ok(out.includes('ctx:80K/1M(8%)'), `glm-5.2 should use 1M size, got: ${out}`);
  assert.ok(out.includes('\x1b[32m'), `8% should be green, got: ${JSON.stringify(out)}`);
}

// 未知模型回退到 payload size
function testContextDisplayUnknownModelFallback() {
  const out = buildContextDisplay(
    { total_input_tokens: 5000, context_window_size: 200000 },
    'some-unknown-model'
  );
  assert.ok(out.includes('ctx:5K/200K(3%)'), `unknown model uses payload size, got: ${out}`);
}

// 没有 total_input_tokens 时回退到 used_percentage × realSize
function testContextDisplayFallbackPercentage() {
  const out = buildContextDisplay(
    { used_percentage: 30, context_window_size: 200000 },
    'glm-5.2'
  );
  // realSize=1M, pct=30, usedTokens=300K
  assert.ok(out.includes('ctx:300K/1M(30%)'), `fallback should use mapping size, got: ${out}`);
}

// 前缀匹配：claude-sonnet-4-6 → claude-sonnet-4- 前缀 → 1M
function testContextDisplayClaudeSonnetPrefix() {
  const out = buildContextDisplay(
    { total_input_tokens: 50000, context_window_size: 200000 },
    'claude-sonnet-4-6'
  );
  assert.ok(out.includes('ctx:50K/1M(5%)'), `sonnet should be 1M, got: ${out}`);
}

// 颜色边界
function testContextDisplayBoundary70() {
  // glm-5.2, 70% → yellow
  const out = buildContextDisplay({ used_percentage: 70, context_window_size: 200000 }, 'glm-5.2');
  assert.ok(out.includes('\x1b[33m'), `70% should be yellow boundary, got: ${JSON.stringify(out)}`);
}

function testContextDisplayBoundary90() {
  // glm-5.2, 90% → red
  const out = buildContextDisplay({ used_percentage: 90, context_window_size: 200000 }, 'glm-5.2');
  assert.ok(out.includes('\x1b[31m'), `90% should be red boundary, got: ${JSON.stringify(out)}`);
}

// === lookupContextWindow ===

function testLookupExact() {
  // 1M 模型
  assert.equal(lookupContextWindow('glm-5.2'), 1_000_000);
  assert.equal(lookupContextWindow('claude-opus-4-7'), 1_000_000);
  assert.equal(lookupContextWindow('gemini-2.5-pro'), 1_000_000);
  assert.equal(lookupContextWindow('gemini-2.5-flash'), 1_000_000);
  assert.equal(lookupContextWindow('qwen3.7-max'), 1_000_000);
  assert.equal(lookupContextWindow('qwen3-max'), 1_000_000);
  // 非 1M
  assert.equal(lookupContextWindow('claude-opus-4-6'), 200_000);
  assert.equal(lookupContextWindow('glm-5.1'), 204_800);
  assert.equal(lookupContextWindow('kimi-k2.5'), 256_000);
  assert.equal(lookupContextWindow('deepseek-v3'), 128_000);
  assert.equal(lookupContextWindow('gpt-4o'), 128_000);
  assert.equal(lookupContextWindow('grok-4'), 256_000);
}

function testLookupPrefix() {
  // 前缀匹配
  assert.equal(lookupContextWindow('claude-sonnet-4-6'), 1_000_000);
  assert.equal(lookupContextWindow('claude-sonnet-4-7'), 1_000_000);
  assert.equal(lookupContextWindow('claude-haiku-4-5-20251001'), 200_000);
  assert.equal(lookupContextWindow('claude-3-5-sonnet'), 200_000);
  assert.equal(lookupContextWindow('gemini-2.0-flash'), 1_000_000);
  assert.equal(lookupContextWindow('gemini-3-pro'), 1_000_000);
  assert.equal(lookupContextWindow('glm-4-plus'), 128_000);
  assert.equal(lookupContextWindow('qwen3-coder'), 256_000);
  assert.equal(lookupContextWindow('qwen2.5-72b'), 128_000);
  assert.equal(lookupContextWindow('moonshot-v1-32k'), 128_000);
}

function testLookupLongestPrefixWins() {
  // 当多个前缀都能匹配时，最长前缀优先
  // 例如：claude-sonnet-4-6 同时匹配 'claude-sonnet-4-' 和 'claude-3-5-'？不，前者更具体
  assert.equal(lookupContextWindow('claude-sonnet-4-6'), 1_000_000);  // 而非 200_000
  // gemini-2.5-pro 同时精确匹配 + 匹配 'gemini-2.0-'/'gemini-3-' 前缀
  assert.equal(lookupContextWindow('gemini-2.5-pro'), 1_000_000);
}

function testLookupUnknown() {
  assert.equal(lookupContextWindow('some-future-model'), 0);
  assert.equal(lookupContextWindow('llama-3.3'), 0);
  assert.equal(lookupContextWindow('mistral-large'), 0);
  assert.equal(lookupContextWindow(''), 0);
  assert.equal(lookupContextWindow(null), 0);
  assert.equal(lookupContextWindow(undefined), 0);
}

// === buildDuration ===

function testDurationMissing() {
  assert.equal(buildDuration(0, Date.now()), '');
  assert.equal(buildDuration(null, Date.now()), '');
  assert.equal(buildDuration(Date.now(), 0), '');
}

function testDurationInverted() {
  // now < start → ''
  assert.equal(buildDuration(Date.now() + 10000, Date.now()), '');
}

function testDurationMinutes() {
  // 5 minutes
  const start = 1_000_000;
  const now = start + 5 * 60 * 1000;
  assert.equal(buildDuration(start, now), '5min');
}

function testDurationHours() {
  // 2h30min
  const start = 1_000_000;
  const now = start + (2 * 3600 + 30 * 60) * 1000;
  assert.equal(buildDuration(start, now), '2h30min');
}

function testDurationDays() {
  // 1d2h30min
  const start = 1_000_000;
  const now = start + (26 * 3600 + 30 * 60) * 1000;
  assert.equal(buildDuration(start, now), '1d2h30min');
}

function testDurationZeroMinutes() {
  // Less than a minute → 0min (boundary case)
  const start = 1_000_000;
  const now = start + 30 * 1000;
  assert.equal(buildDuration(start, now), '0min');
}

// === Runner ===

const tests = [
  testFormatTokensZero, testFormatTokensSmall, testFormatTokensK, testFormatTokensM, testFormatTokensInvalid,
  testCalcCacheRateZeroDenominator, testCalcCacheRateAllHit, testCalcCacheRateAllMiss, testCalcCacheRateMixed, testCalcCacheRateRounding,
  testParseUsageEmpty, testParseUsageAggregate, testParseUsageSkipsBadLines, testParseUsageMissingTokensField, testParseUsageLimit, testParseUsageDefaultLimit,
  testContextDisplayMissing, testContextDisplayKnownModelUsesMapping, testContextDisplayUnknownModelFallback, testContextDisplayFallbackPercentage, testContextDisplayClaudeSonnetPrefix, testContextDisplayBoundary70, testContextDisplayBoundary90,
  testLookupExact, testLookupPrefix, testLookupLongestPrefixWins, testLookupUnknown,
  testDurationMissing, testDurationInverted, testDurationMinutes, testDurationHours, testDurationDays, testDurationZeroMinutes,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`# PASS: ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`# FAIL: ${t.name}`);
    console.log(`  ${e.message}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed${failed === 0 ? '' : ', ' + failed + ' failed'}`);
if (failed > 0) process.exit(1);
