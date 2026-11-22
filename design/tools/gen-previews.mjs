// 生成评审用 HTML 镜像 R3（与小程序 WXSS 1:1 对应, rpx÷2=px, 含仿真原生导航）
// 用法: node design/tools/gen-previews.mjs
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(process.cwd(), 'design/preview');
fs.mkdirSync(OUT, { recursive: true });

const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
.phone { width:390px; background:#F7F4EC; color:#1F2A26; position:relative;
  font: 14px/1.65 -apple-system,'PingFang SC','Hiragino Sans GB',sans-serif; -webkit-font-smoothing:antialiased; }
.serif { font-family:'Songti SC','STSong','SimSun',serif; }
.mono { font-family:'SF Mono','Menlo',monospace; }
.container { padding:12px 14px 24px; }

/* 仿真原生 chrome */
.statusbar { height:34px; background:#F7F4EC; display:flex; justify-content:space-between; align-items:center; padding:0 18px; font-size:12px; font-weight:600; }
.statusbar .batt { width:20px; height:10px; border:1px solid #1F2A26; border-radius:2px; position:relative; }
.statusbar .batt::after { content:''; position:absolute; inset:1.5px; right:5px; background:#1F2A26; }
.navbar { height:44px; background:#F7F4EC; display:flex; align-items:center; justify-content:center; position:relative; font-size:17px; font-weight:600; }
.navbar .back { position:absolute; left:14px; font-size:24px; font-weight:400; line-height:1; }
.bottom-home { height:18px; }

/* 报头 */
.masthead { display:flex; justify-content:space-between; align-items:baseline; padding:5px 2px 11px; border-bottom:4px double #175243; }
.masthead-title { font-family:'Songti SC','STSong',serif; font-size:26px; font-weight:900; letter-spacing:6px; color:#175243; }
.masthead-issue { font-family:'SF Mono','Menlo',monospace; font-size:10px; letter-spacing:1px; color:#57534A; }

/* 检索行 */
.search-bar { display:flex; align-items:center; gap:12px; padding:12px 2px 10px; border-bottom:1px solid #B9B2A0; margin-bottom:4px; }
.search-ph { color:#9A9482; flex:1; margin-left:6px; font-size:14px; }
.search-ico { width:15px; height:15px; border:1.5px solid #6C6659; border-radius:50%; position:relative; flex-shrink:0; }
.search-ico::after { content:''; position:absolute; width:6px; height:1.5px; background:#6C6659; transform:rotate(45deg); right:-5px; bottom:-2px; }
.text-action { display:flex; align-items:center; min-height:32px; color:#175243; font-size:12px; letter-spacing:2px; }
.text-action.on::before { content:''; width:6px; height:6px; background:#B5442D; border-radius:50%; margin-right:5px; }

/* 已选条件 */
.chips { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 2px 2px; }
.chip { display:flex; align-items:center; gap:5px; border-bottom:1px solid #B9B2A0; color:#57534A; padding:2px 3px; font-size:12px; }
.chip b { color:#6C6659; font-weight:400; }
.clear { color:#57534A; font-size:12px; letter-spacing:1px; }

/* 条目 (连续纸面) */
.entry { padding:16px 2px 15px; border-bottom:1px solid #D9D3C2; }
.ehead { display:flex; align-items:flex-start; }
.ava-seal { width:48px; height:48px; margin-right:13px; flex-shrink:0; background:#B5442D; color:#FBF7EF; font-family:'Songti SC',serif; font-size:22px; font-weight:900; display:flex; align-items:center; justify-content:center; border-radius:1px; box-shadow:inset 0 0 0 1.5px rgba(251,247,239,.35); }
.ava-photo { width:52px; height:52px; margin-right:11px; flex-shrink:0; border:1px solid #B9B2A0; padding:2px; background:#F7F4EC; }
.ava-photo .sil { width:48px; height:48px; background:#CBC5B4; position:relative; overflow:hidden; }
.ava-photo .sil::before { content:''; position:absolute; width:16px; height:16px; background:#A8A28F; border-radius:50%; left:16px; top:10px; }
.ava-photo .sil::after { content:''; position:absolute; width:30px; height:16px; background:#A8A28F; border-radius:9px 9px 0 0; left:9px; bottom:-2px; }
.tinfo { flex:1; min-width:0; }
.nrow { display:flex; align-items:center; gap:7px; }
.name { font-family:'Songti SC',serif; font-size:17px; font-weight:900; letter-spacing:1px; }
.seal { background:#B5442D; color:#FBF7EF; font-family:'Songti SC',serif; font-size:10px; letter-spacing:1px; padding:2px 5px; border-radius:1px; box-shadow:inset 0 0 0 1px rgba(251,247,239,.4); }
.edu { color:#57534A; font-size:12px; margin-top:4px; letter-spacing:.5px; }
.subjline { margin-top:5px; color:#175243; font-size:12px; letter-spacing:.5px; }
.statline { margin-top:10px; display:flex; align-items:baseline; flex-wrap:wrap; }
.statline .piece { display:flex; align-items:baseline; gap:4px; }
.statline .k { font-size:11px; color:#6C6659; letter-spacing:1px; }
.statline .n { font-family:'Songti SC',serif; font-weight:900; color:#1F2A26; font-size:15px; font-feature-settings:'tnum'; }
.statline .u { font-size:11px; color:#6C6659; }
.statline .dot { margin:0 7px; color:#B9B2A0; }
.bio { margin-top:6px; color:#57534A; font-size:11px; line-height:1.7; }

/* 骨架: 排字中 */
.skel { padding:16px 2px; border-bottom:1px solid #D9D3C2; display:flex; gap:13px; }
.skel .box { width:48px; height:48px; background:#ECE7DA; flex-shrink:0; animation:pulse 1.2s ease-in-out infinite alternate; }
.kicker { font-size:11px; letter-spacing:6px; color:#6C6659; padding:15px 2px 2px; text-align:center; }
.skel .lines { flex:1; padding-top:6px; }
.skel .rule { height:1px; background:#B9B2A0; margin-bottom:13px; animation:pulse 1.2s ease-in-out infinite alternate; }
.skel .rule.w90 { width:90%; }
.skel .rule.w70 { width:70%; }
.skel .rule.w50 { width:50%; margin-bottom:0; }
@keyframes pulse { from { opacity:.45; } to { opacity:1; } }

/* 状态: 启事 */
.state { text-align:center; padding:55px 20px 62px; border-top:1px solid #D9D3C2; }
.state .kicker { display:block; font-size:11px; letter-spacing:6px; color:#6C6659; margin-bottom:13px; }
.state .copy { font-family:'Songti SC',serif; font-size:16px; letter-spacing:4px; color:#1F2A26; }
.state .btn { display:inline-block; margin-top:20px; border:1px solid #175243; color:#175243; font-size:13px; letter-spacing:2px; padding:8px 23px; border-radius:1px; }
.state .btn.danger { border-color:#B5442D; color:#B5442D; }

/* 详情 */
.dhead { display:flex; align-items:flex-start; padding:8px 0 15px; border-bottom:4px double #175243; }
.dava { width:64px; height:64px; margin-right:15px; flex-shrink:0; background:#B5442D; color:#FBF7EF; font-family:'Songti SC',serif; font-size:32px; font-weight:900; display:flex; align-items:center; justify-content:center; border-radius:1px; box-shadow:inset 0 0 0 2px rgba(251,247,239,.35); }
.dhead .name { font-size:22px; letter-spacing:1.5px; }
.mrow { display:flex; font-size:12px; margin-bottom:4px; }
.mrow .k { width:62px; color:#6C6659; letter-spacing:2px; flex-shrink:0; }
.mrow .v { color:#57534A; flex:1; }
.dstats { display:flex; margin:0 -14px; border-bottom:1px solid #B9B2A0; }
.dstats .st { flex:1; text-align:center; padding:14px 0; border-left:1px solid #D9D3C2; }
.dstats .st:first-child { border-left:none; }
.dstats .v { display:block; font-family:'Songti SC',serif; font-size:20px; font-weight:900; color:#1F2A26; font-feature-settings:'tnum'; }
.dstats .l { display:block; font-size:11px; color:#6C6659; margin-top:4px; letter-spacing:3px; }
.dsec { padding:18px 2px 8px; border-bottom:1px solid #D9D3C2; }
.dsec:last-child { border-bottom:none; }
.sect { display:flex; align-items:center; gap:10px; font-family:'Songti SC',serif; font-size:13px; font-weight:700; letter-spacing:3px; margin-bottom:11px; }
.sect::after { content:''; flex:1; height:1px; background:#B9B2A0; }
.cred { display:inline-flex; align-items:center; gap:5px; border:1px solid #6C6659; border-radius:1px; padding:4px 10px; color:#57534A; font-size:12px; margin:0 7px 7px 0; }
.review { padding:12px 0; border-bottom:1px dashed #B9B2A0; }
.review:last-child { border-bottom:none; }
.rhead { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
.rr { font-family:'Songti SC',serif; font-weight:900; color:#1F2A26; font-size:15px; font-feature-settings:'tnum'; }
.rt { font-family:'SF Mono','Menlo',monospace; color:#6C6659; font-size:11px; }
.rc { font-size:12px; line-height:1.8; color:#1F2A26; }
.folio { padding:20px 0 10px; text-align:center; font-size:11px; color:#6C6659; letter-spacing:2px; font-family:'Songti SC',serif; border-top:1px solid #D9D3C2; }
.botbar { position:absolute; bottom:18px; left:0; right:0; background:#F7F4EC; border-top:1px solid #B9B2A0; padding:10px 14px 14px; display:flex; gap:10px; margin:0 -14px; }
.botbar .ghost { flex:1; height:44px; line-height:40px; text-align:center; font-size:14px; letter-spacing:1px; color:#175243; border:1px solid #175243; border-radius:1px; background:transparent; }
.botbar .main { flex:1; height:44px; line-height:44px; text-align:center; font-size:14px; letter-spacing:1px; background:#175243; color:#F7F4EC; border-radius:1px; }

/* 评语页 */
.sec { padding:18px 2px 10px; border-bottom:1px solid #D9D3C2; }
.starrow { display:flex; align-items:baseline; gap:12px; padding:2px 2px 7px; }
.starrow .st { display:flex; gap:5px; }
.starrow .st span { font-size:20px; color:#F7F4EC; -webkit-text-stroke:1px #175243; line-height:1; }
.starrow .st span.on { color:#175243; -webkit-text-stroke:0; }
.starrow .t { font-size:12px; color:#57534A; letter-spacing:1px; }
.pgrid { position:relative; border:1px solid #B9B2A0; border-radius:1px; background-color:#F7F4EC; background-image:repeating-linear-gradient(to bottom, transparent 0, transparent 25px, rgba(23,82,67,.22) 25px, rgba(23,82,67,.22) 26px); background-position:0 8px; }
.pgrid .well { height:150px; background:transparent; border:none; border-radius:0; padding:8px 11px 22px; font-size:14px; line-height:26px; }
.pgrid .charc { position:absolute; right:8px; bottom:5px; margin:0; background:#F7F4EC; padding:0 4px; }
.charc { text-align:right; font-size:11px; color:#6C6659; margin-top:7px; font-family:'SF Mono','Menlo',monospace; }
.anon { display:flex; align-items:center; gap:8px; padding:18px 2px 5px; font-size:14px; }
.cbx { width:20px; height:20px; border:1px solid #57534A; background:#F7F4EC; display:inline-flex; align-items:center; justify-content:center; color:#F7F4EC; font-size:14px; font-weight:700; }
.cbx.on { background:#175243; border-color:#175243; }
.submit { width:100%; height:46px; line-height:46px; text-align:center; font-size:15px; letter-spacing:2px; background:#175243; color:#F7F4EC; border-radius:1px; margin-top:20px; }

/* 筛选抽屉 */
.scrim { position:absolute; inset:0; background:rgba(30,28,20,.45); }
.sheet { position:absolute; left:0; right:0; bottom:0; background:#F7F4EC; border-top:3px double #175243; padding:14px 14px 18px; }
.sheethead { display:flex; justify-content:space-between; align-items:baseline; padding:2px 2px 11px; border-bottom:4px double #175243; }
.sheethead .t { font-family:'Songti SC',serif; font-size:17px; font-weight:900; letter-spacing:3px; }
.sheethead .c { font-family:'SF Mono','Menlo',monospace; font-size:10px; color:#57534A; }
.fgroup { padding:13px 2px; border-bottom:1px solid #D9D3C2; }
.fgroup .flabel { font-size:12px; color:#6C6659; letter-spacing:3px; margin-bottom:12px; }
.opts { display:flex; flex-wrap:wrap; gap:9px; }
.opt { min-height:36px; padding:0 18px; display:inline-flex; align-items:center; border:1px solid #B9B2A0; border-radius:1px; font-size:13px; color:#57534A; }
.opt.on { background:#175243; color:#F7F4EC; border-color:#175243; }
.prange { display:flex; align-items:center; gap:12px; }
.pinput { flex:1; height:38px; line-height:34px; text-align:center; border-bottom:1px solid #B9B2A0; font-size:13px; color:#1F2A26; font-family:'SF Mono','Menlo',monospace; }
.pinput.ph { color:#9A9482; }
.psep { color:#6C6659; font-family:'SF Mono','Menlo',monospace; }
.punit { font-size:11px; color:#6C6659; letter-spacing:1px; }
.fact { display:flex; gap:10px; padding:16px 2px 4px; }
.fact .reset { flex:1; height:42px; line-height:38px; text-align:center; font-size:14px; letter-spacing:1px; color:#57534A; border:1px solid #B9B2A0; border-radius:1px; }
.fact .apply { flex:1; height:42px; line-height:42px; text-align:center; font-size:14px; letter-spacing:1px; background:#175243; color:#F7F4EC; border-radius:1px; }

/* 成功印章 */
.stamp-wrap { text-align:center; padding:56px 20px; position:relative; }
.stamp { display:inline-flex; align-items:center; justify-content:center; width:96px; height:96px; border:3px solid #B5442D; color:#B5442D; border-radius:4px; transform:rotate(-6deg); font-family:'Songti SC',serif; font-size:24px; font-weight:900; letter-spacing:4px; box-shadow:inset 0 0 0 1.5px #B5442D; opacity:.9; }
.stamp-wrap .after { display:block; margin-top:24px; font-size:12px; color:#6C6659; letter-spacing:1px; }

/* shot-e 组合页 */
.combo { background:#2B2B28; padding:24px 0; display:flex; flex-direction:column; align-items:center; gap:24px; }
`;

const chrome = (title, back) => `
<div class="statusbar"><span>9:41</span><span class="batt"></span></div>
<div class="navbar">${back ? '<span class="back">‹</span>' : ''}${title}</div>`;

const entry = (name, seal, edu, subj, rating, price, exp, bio, photo) => `
<div class="entry">
  <div class="ehead">
    ${photo
      ? '<div class="ava-photo"><div class="sil"></div></div>'
      : `<div class="ava-seal">${name[0]}</div>`}
    <div class="tinfo">
      <div class="nrow"><span class="name">${name}</span>${seal ? '<span class="seal">认证</span>' : ''}</div>
      <div class="edu">${edu}</div>
      <div class="subjline">${subj}</div>
    </div>
  </div>
  <div class="statline">
    <div class="piece"><span class="k">评分</span><span class="n">${rating}</span></div>
    <span class="dot">·</span>
    <div class="piece"><span class="k">时薪</span><span class="n">${price}</span><span class="u">元/时</span></div>
    <span class="dot">·</span>
    <div class="piece"><span class="k">教龄</span><span class="n">${exp} 年</span></div>
  </div>
  <div class="bio">${bio}</div>
</div>`;

const page = (title, body) =>
  `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${CSS}</style></head><body>${body}</body></html>`;

// ---------- shot-a: 首页 ----------
const shotA = page('a', `
<div class="phone">
  ${chrome('本期目录', false)}
  <div class="container" style="padding-bottom:0;">
    <div class="masthead"><span class="masthead-title">家教公报</span><span class="masthead-issue">NO.2026-1122</span></div>
    <div class="search-bar"><span class="search-ico"></span><span class="search-ph">检索科目、年级、地点…</span><span class="text-action">筛选</span></div>
    <div class="chips"><span class="chip">数学 <b>×</b></span><span class="chip">高中 <b>×</b></span><span class="clear">清除全部</span></div>
    ${entry('王雨桐', true, '硕士 · 华东师范大学 · 数学', '【数学】【物理】', '4.9', 180, 5,
      '带过三届毕业班，擅长把难题拆成小步骤，学生平均提分 20+。')}
    ${entry('李牧之', false, '本科 · 复旦大学 · 英语', '【英语】【语文】', '4.8', 150, 3,
      '雅思 8 分，注重口语与写作双线训练，课堂节奏紧凑不拖沓。', true)}
    ${entry('陈之遥', true, '博士 · 上海交通大学 · 物理', '【物理】【化学】', '5.0', 260, 8,
      '竞赛带队经验丰富，讲题从物理图像入手，不背公式。')}
  </div>
  <div class="bottom-home"></div>
</div>`);

// ---------- shot-b: 教师档案 ----------
const dsec = (t, inner) => `<div class="dsec"><div class="sect">${t}</div>${inner}</div>`;
const shotB = page('b', `
<div class="phone" style="height:1250px;">
  ${chrome('教师档案', true)}
  <div class="container" style="padding-bottom:0;">
    <div class="dhead">
      <div class="dava" style="font-size:28px;">王</div>
      <div class="tinfo">
        <div class="nrow" style="margin-bottom:6px;"><span class="name">王雨桐</span><span class="seal" style="font-size:11px;padding:2px 6px;">认证</span></div>
        <div class="edu" style="font-size:12px;">硕士 · 华东师范大学 · 数学</div>
        <div class="subjline" style="margin-top:7px;">【数学】【物理】</div>
        <div style="margin-top:7px;">
          <div class="mrow"><span class="k">所在地</span><span class="v">上海市杨浦区</span></div>
          <div class="mrow"><span class="k">年级</span><span class="v">初中 · 高中</span></div>
        </div>
      </div>
    </div>
    <div style="margin:0 -14px;padding:6px 14px 8px;border-bottom:1px solid #B9B2A0;">
      <div style="display:flex;align-items:flex-end;padding:6px 0;"><span style="font-size:12px;color:#57534A;letter-spacing:2px;padding-bottom:3px;flex-shrink:0;">评分</span><span style="flex:1;border-bottom:1px dotted #B9B2A0;margin:0 8px 5px;"></span><span class="serif" style="font-weight:900;font-size:17px;font-feature-settings:'tnum';">4.9</span></div>
      <div style="display:flex;align-items:flex-end;padding:6px 0;"><span style="font-size:12px;color:#57534A;letter-spacing:2px;padding-bottom:3px;flex-shrink:0;">时薪</span><span style="flex:1;border-bottom:1px dotted #B9B2A0;margin:0 8px 5px;"></span><span class="serif" style="font-weight:900;font-size:17px;font-feature-settings:'tnum';">180<span style="font-size:11px;font-weight:400;color:#6C6659;"> 元/时</span></span></div>
      <div style="display:flex;align-items:flex-end;padding:6px 0;"><span style="font-size:12px;color:#57534A;letter-spacing:2px;padding-bottom:3px;flex-shrink:0;">评价</span><span style="flex:1;border-bottom:1px dotted #B9B2A0;margin:0 8px 5px;"></span><span class="serif" style="font-weight:900;font-size:17px;font-feature-settings:'tnum';">27<span style="font-size:11px;font-weight:400;color:#6C6659;"> 条</span></span></div>
    </div>
    ${dsec('个人简介', '<div style="font-size:14px;line-height:1.9;">市重点中学在职教师，十五年教龄。讲课逻辑清晰，善于从错题反推知识漏洞，每节课配独立练习清单。</div>')}
    ${dsec('可授课时间', '<div style="font-size:14px;">周六日全天 · 工作日晚间可约</div>')}
    ${dsec('资质证明', '<span class="cred"><span style="color:#175243;font-weight:700;">✓</span> 教师资格证</span><span class="cred"><span style="color:#175243;font-weight:700;">✓</span> 学历证书</span>')}
    ${dsec('学员评价', `
      <div class="review"><div class="rhead"><span class="rr">5 分</span><span class="rt">3 天前</span></div><div class="rc">王老师讲题很有耐心，孩子这次月考数学从 82 提到了 95。</div></div>
      <div class="review"><div class="rhead"><span class="rr">4 分</span><span class="rt">2 周前</span></div><div class="rc">讲解细致，就是时间不太好约，热门时段要提前一周定。</div></div>`)}
    <div class="folio">本档案核验于 NO.2026-1122 · 家教公报</div>
    <div class="botbar"><div class="ghost">写评语</div><div class="main">联系家教</div></div>
  </div>
  <div class="bottom-home"></div>
</div>`);

// ---------- shot-c: 撰写评语 ----------
const shotC = page('c', `
<div class="phone">
  ${chrome('撰写评语', true)}
  <div class="container" style="padding-bottom:0;">
    <div style="display:flex;align-items:center;padding:14px 2px;border-bottom:4px double #175243;">
      <div class="ava-seal" style="width:52px;height:52px;font-size:24px;">王</div>
      <div><div class="name" style="display:block;font-size:17px;margin-bottom:3px;">王雨桐</div><div class="edu" style="margin-top:0;">硕士 · 华东师范大学</div></div>
    </div>
    <div class="sec">
      <div class="sect">评分</div>
      <div class="starrow">
        <div class="st">${[1,2,3,4,5].map(i => `<span class="${i <= 4 ? 'on' : ''}">★</span>`).join('')}</div>
        <span class="t">满意，有明显帮助</span>
      </div>
    </div>
    <div class="sec">
      <div class="sect">评语内容</div>
      <div class="pgrid"><div class="well">王老师讲题很有耐心，每次课后都会整理错题清单发给我们，孩子学起来轻松多了。</div><div class="charc">38/500</div></div>
    </div>
    <div class="anon"><span class="cbx on">✓</span>匿名评语</div>
    <div class="submit">存入公报</div>
    <div class="folio" style="border-top:none;padding:14px 0 4px;">本评语经核验后录入教学公报 · 可选择匿名刊出</div>
  </div>
  <div class="bottom-home"></div>
</div>`);

// ---------- shot-d: 筛选抽屉 ----------
const opt = (t, on) => `<span class="opt ${on ? 'on' : ''}">${t}</span>`;
const shotD = page('d', `
<div class="phone" style="height:800px;overflow:hidden;">
  ${chrome('教师名录', false)}
  <div class="container">
    <div class="search-bar"><span class="search-ico"></span><span class="search-ph">检索科目、年级、地点…</span><span class="text-action on">筛选</span></div>
    ${entry('王雨桐', true, '硕士 · 华东师范大学 · 数学', '【数学】【物理】', '4.9', 180, 5, '带过三届毕业班，擅长把难题拆成小步骤。')}
  </div>
  <div class="scrim"></div>
  <div class="sheet">
    <div class="sheethead"><span class="t">筛选</span><span class="c">已选 2 项</span></div>
    <div class="fgroup"><div class="flabel">科目</div><div class="opts">${opt('语文')}${opt('数学', true)}${opt('英语')}${opt('物理')}${opt('化学')}</div></div>
    <div class="fgroup"><div class="flabel">年级</div><div class="opts">${opt('小学')}${opt('初中')}${opt('高中', true)}</div></div>
    <div class="fgroup" style="border-bottom:none;"><div class="flabel">价格范围</div>
      <div class="prange"><span class="pinput">200</span><span class="psep">—</span><span class="pinput ph">最高</span><span class="punit">元/时</span></div>
    </div>
    <div class="fact"><div class="reset">重置</div><div class="apply">应用筛选</div></div>
  </div>
</div>`);

// ---------- shot-e: 四态组合（迷你整机） ----------
const mini = (inner, h) => `<div class="phone" style="min-height:${h}px;">${chrome('本期目录', false)}${inner}<div class="bottom-home"></div></div>`;
const searchRow = `<div class="search-bar" style="margin-bottom:0;"><span class="search-ico"></span><span class="search-ph">检索科目、年级、地点…</span><span class="text-action">筛选</span></div>`;
const shotE = page('e', `
<div class="combo">
  ${mini(`<div class="container">
    ${searchRow}
    <div class="kicker" style="letter-spacing:6px;">付梓中</div><div class="skel"><div class="box"></div><div class="lines"><div class="rule w90"></div><div class="rule w70"></div><div class="rule w50"></div></div></div>
    <div class="kicker" style="letter-spacing:6px;">付梓中</div><div class="skel"><div class="box"></div><div class="lines"><div class="rule w90"></div><div class="rule w70"></div><div class="rule w50"></div></div></div>
  </div>`, 300)}
  ${mini(`<div class="container">
    ${searchRow}
    <div class="state"><span class="kicker" style="letter-spacing:6px;">启事</span><div class="copy">本期暂无记录</div><div class="btn">调整检索</div></div>
  </div>`, 280)}
  ${mini(`<div class="container">
    ${searchRow}
    <div class="state"><span class="kicker" style="letter-spacing:6px;">启事</span><div class="copy">检索失败</div><div class="btn danger">重新检索</div></div>
  </div>`, 280)}
  ${mini(`<div class="stamp-wrap"><div class="stamp">已收录</div><span class="after">感谢您的评语，将展示在教师档案中</span></div>`, 280)}
</div>`);

const files = { 'shot-a.html': shotA, 'shot-b.html': shotB, 'shot-c.html': shotC, 'shot-d.html': shotD, 'shot-e.html': shotE };
for (const [name, html] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), html);
  console.log('written', name);
}
