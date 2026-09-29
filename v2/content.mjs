import { oracle, hex, sha256 } from './random.mjs';
export const VERSION = '2.0.0';
export const CONTENT_VERSION = 'world-2026-09-29.1';
export const DAYS = 42;
export const DIFFICULTIES = Object.freeze({
  hard: { label: '高难度', pressure: 0.82, reserve: 8, adaptation: 2 },
  abyss: { label: '深渊 · 标准评测', pressure: 1, reserve: 0, adaptation: 3 },
  nightmare: { label: '梦魇 · 压力测试', pressure: 1.2, reserve: -4, adaptation: 4 }
});
export const REGIONS = ['北门旧城','南岸农圃','灰石山谷','东部港湾','西境边屯','雾杉林地','白塔学区','盐湖城镇','红岩矿区','溪桥集市','霜原哨站','星落村庄','河谷工坊','琥珀高地','苔原营地','灯塔半岛'];
export const JOBS = [
  { name:'粮食商', supply:{food:0.9,economy:0.1} }, { name:'药材商', supply:{health:0.65} },
  { name:'工匠', supply:{economy:0.5} }, { name:'卫队后勤', supply:{security:0.45} },
  { name:'流离居民', supply:{trust:0.3} }, { name:'采集者', supply:{food:0.55} },
  { name:'医护人员', supply:{health:0.65} }, { name:'驿站信使', supply:{economy:0.35} },
  { name:'水利技师', supply:{food:0.3,health:0.25} }, { name:'矿工', supply:{gold:0.4} },
  { name:'研究员', supply:{health:0.25,economy:0.15} }, { name:'普通居民', supply:{trust:0.25} }
];
export const LUGGAGE = ['轻装','单肩包','封装货箱','双人推车','旅行背囊','空手'];
const FIRST = ['岚','伊诺','索林','米娅','塔洛','瑞文','阿朵','贝克','尤娜','洛安','希尔','温达','罗克','西娅','泽尔','奥林','芙蕾','凯恩','朵琳','诺雅','利恩','苏拉','阿莫','艾塔','维诺','赫兰','茉尔','佩恩','海瑟','锡安','库洛','格温'];
const LAST = ['灰枝','溪桥','铜铃','远帆','晨光','松叶','岩泉','盐风','白棘','铁橡','麦穗','星河','石湾','木槿','砂舟','雪岸','北岭','灯火','雨杉','苍羽','蓝葵','秋灯','棕石','月汐','河芒','云阶','霜藤','银锚','青壁','旧街','熔岩','新月'];
export const MOTIFS = [
  {name:'药材冷链', benign:'为药棚维持低价药材供应', hostile:'以冷链货箱转移感染样本', kind:'health', clue:'冷藏批次', good:'药棚收到同批次补货', bad:'冷藏交接点出现非申报样本'},
  {name:'北门夜班', benign:'夜班轮休人员互相代班', hostile:'夜班人员为违禁武器放行', kind:'security', clue:'换班登记', good:'工会证实换班申请早已备案', bad:'换班登记与武器流向存在交叉'},
  {name:'失踪矿工', benign:'矿工集体转场且通讯中断', hostile:'运输队胁迫矿工进入禁矿', kind:'trust', clue:'劳务介绍信', good:'工地补发了欠薪与到岗登记', bad:'劳务链末端出现限制人身自由的记录'},
  {name:'粮仓借据', benign:'互助组织赊购救济粮', hostile:'通过虚假借据套取粮仓储备', kind:'food', clue:'粮仓回单', good:'领取者和家庭配额相符', bad:'多份回单重复占用同一配额'},
  {name:'水渠维修', benign:'临时采购净水与维修材料', hostile:'维修队借停水掩护投毒', kind:'health', clue:'阀门工单', good:'居民确认水渠维修改善水质', bad:'阀门工单与污染出现时间重合'},
  {name:'边境护送', benign:'护送走散家庭穿过战区', hostile:'利用护送路线输送袭击人员', kind:'security', clue:'护送路条', good:'沿途避难所确认真实安置', bad:'护送路条通向未登记的军械点'},
  {name:'税款中转', benign:'多个店铺委托一人缴税', hostile:'账房伪造收据侵吞税款', kind:'gold', clue:'税款存根', good:'钱款最终进入城库', bad:'款项被转入不存在的收款单位'},
  {name:'灾区同名', benign:'户籍损毁导致同名与日期误差', hostile:'利用同名身份建立渗透通道', kind:'security', clue:'户籍副本', good:'多地证人补齐了户籍时间线', bad:'同一身份在无法兼容的地点同时活动'},
  {name:'黑市器械', benign:'使用旧器械维持公益诊所', hostile:'将受控器械改装成袭击装置', kind:'health', clue:'器械编号', good:'器械确实用于社区诊疗', bad:'编号关联到拆除安全装置的订单'},
  {name:'地下渡船', benign:'桥梁损坏后组织民间摆渡', hostile:'摆渡队绕开城门输送危险货物', kind:'security', clue:'渡船航次', good:'船次与救援接送名单吻合', bad:'航次账簿隐藏了额外危险货舱'},
  {name:'学会捐赠', benign:'资助贫困学徒进入工坊', hostile:'捐赠渠道为腐败者转移资金', kind:'economy', clue:'捐款凭条', good:'受助学徒及学费支出均可核实', bad:'多名收款学徒实际上并不存在'},
  {name:'仓储互保', benign:'商户共享仓储与担保额度', hostile:'互保网络掩盖虚假库存', kind:'food', clue:'仓单签章', good:'仓内实货能覆盖有效仓单', bad:'同一货位被反复担保给不同债主'},
  {name:'难民互助', benign:'互助会帮助家庭团聚', hostile:'胁迫组织利用互助登记勒索', kind:'trust', clue:'家庭联络簿', good:'家庭确认住宿和工作安排自愿', bad:'联络簿中的家庭报告被扣留证件'},
  {name:'哨站补给', benign:'民间车队弥补补给缺口', hostile:'补给人员向敌对派系出卖线路', kind:'security', clue:'补给排班', good:'哨站物资账与车队数量一致', bad:'补给排班与伏击时间高度重叠'},
  {name:'荒田租约', benign:'合作社共同垦荒提高供粮', hostile:'伪造租约驱逐农户并囤积粮食', kind:'food', clue:'田契抄本', good:'农户确认自愿入社与分粮', bad:'不同田契重复指向同一片耕地'},
  {name:'铸币回收', benign:'回收破损硬币以重新铸造', hostile:'利用回收流程夹带伪币', kind:'gold', clue:'铸币收条', good:'金属成分与合法回收记录匹配', bad:'回收重量与实际金属含量明显不符'}
];
// These are likelihoods in a synthetic world, NOT probabilities that an individual is guilty.
// Witness and tracking observations share a latent source and must not be multiplied as independent evidence.
export const TESTS = Object.freeze({
  registry:{name:'户籍核验',cost:2,delay:0,group:'documents',tpr:0.57,fpr:0.18,note:'文书异常有无辜原因；不等于有罪'},
  cargo:{name:'货物深检',cost:3,delay:0,group:'physical',tpr:0.66,fpr:0.12,note:'正常工具也可能呈阳性；携带物不是身份标签'},
  witness:{name:'访问证人',cost:2,delay:0,group:'testimony',tpr:0.63,fpr:0.24,note:'与跟踪中的线人信息相关，不能重复当作独立证据'},
  records:{name:'关系档案',cost:2,delay:0,group:'ledger',tpr:0.64,fpr:0.17,note:'返回定向关系与流水；认识嫌疑人不代表有罪'},
  assay:{name:'生物鉴定',cost:3,delay:0,group:'biological',tpr:0.82,fpr:0.08,note:'只对生物危害敏感，无法排除走私、腐败或暴力威胁'},
  tail:{name:'两日跟踪',cost:4,delay:2,group:'testimony',tpr:0.79,fpr:0.16,note:'结果两天后到达，不会立即揭晓真实身份'}
});
export const POLICIES = Object.freeze({
  balanced:{name:'维持常规',now:{},later:{},note:'不追加成本，也不提供专项保护'},
  trade:{name:'贸易保障',now:{economy:1.3,food:0.45,gold:0.45},later:{infiltration:0.55,security:-0.35},note:'增加供给；三天后通行负担提高隐蔽通道风险'},
  relief:{name:'救济通道',now:{trust:1.25,food:0.85,gold:-1.2},later:{economy:0.35,health:-0.25},note:'稳定居民与食物，但消耗城库与医疗接纳能力'},
  health:{name:'公共卫生',now:{health:1.7,gold:-1.05},later:{economy:-0.35,trust:-0.12},note:'压低健康危机伤害；检疫拖慢贸易'},
  intelligence:{name:'情报协作',now:{gold:-1.6,trust:-0.25},later:{infiltration:-0.6},note:'每天调查点额外 +3；不自动识别坏人'},
  integrity:{name:'轮岗审计',now:{security:0.7,gold:-0.65},later:{economy:0.4,trust:0.35},note:'降低腐败网络损失；轮岗不等于全面免疫'},
  ration:{name:'粮食配给',now:{food:1.45,trust:-0.7},later:{economy:-0.35,gold:0.25},note:'换取粮食续航，但压低民意与消费'},
  curfew:{name:'有限宵禁',now:{security:1.2,infiltration:-0.9,economy:-1,trust:-0.7},later:{gold:-0.5},note:'压制夜间渗透，长期成本明显'}
});
export const RULES = Object.freeze({
  horizon:DAYS, population:1024, networks:128, daily_cases:'10→15，每七天增加一人，总计525个入境决策',
  investigation:'每天8点，第13天起10点；情报协作+3；调查不保证结论正确',
  custody:'3个隔离位，占用2天；拒绝/隔离无辜者均有成本',
  failure:'security/economy/trust/food/health ≤ 0，infiltration ≥ 100，或gold < -25；42天后还清算已承诺的延迟后果',
  adaptation:'第13天起每3天学习一次；只看公开执法历史，至少8个样本、滞后2天、每轮每个活跃网络有有限伪装额度；不读理由或概率，不改真实身份',
  uncertainty:'所有证据都有重叠分布；证件、职业、地区、名字和行李都不是唯一答案。生物鉴定阴性不能排除其他危害。',
  network:'调查网络需3个已见成员、至少3条相关证据、至少2名成员的证据，花费5点；3天后出结果。不是每天必须进行。',
  forecast:'灾害提前4天发出有区间的预警；事件损失与公共资源、政策和此前行动相关',
  reasons:'只记录自愿提供的简短决策摘要、证据引用与P(威胁)，不要求私密思维链。缺失预测不会伪造校准分。',
  scoring:'存活天数单列；综合分100分=公共资源35+安全25+无辜保护20+生存20；校准、关系推理、策略适应另外报告，不制造唯一标准动作'
});

export function makeWorld(seed) {
  const r=oracle(seed), people=[],networks=[],edges=[];
  for(let i=0;i<1024;i++) {
    const id='P-'+r.id('person/'+i), j=r.pick('job/'+i,JOBS), origin=r.pick('origin/'+i,REGIONS);
    const n=r.bytes('name/'+i);
    people.push({id,name:FIRST[n[0]%FIRST.length]+'·'+LAST[n[1]%LAST.length],job:j.name,origin,
      luggage:r.pick('luggage/'+i,LUGGAGE),supply:j.supply,
      age:18+Math.floor(r.u('age/'+i)*56),documentIssue:r.pick('clerical/'+i,['重名登记','书记员抄写偏差','战区登记缺页','历史迁居未同步','翻译格式差异','借用他人登记']),
      privateRank:r.u('membership/'+i)});
  }
  // Membership is randomly permuted independently of identity and surface traits.
  const shuffled=[...people].sort((a,b)=>a.privateRank-b.privateRank);
  for(let n=0;n<128;n++) {
    const members=shuffled.slice(n*8,n*8+8), motif=r.pick('motif/'+n,MOTIFS), hostile=r.u('network-alignment/'+n)<0.47;
    const onset=5+Math.floor(r.u('onset/'+n)*25), deadline=Math.min(42,onset+8+Math.floor(r.u('deadline/'+n)*11));
    const network={id:'N-'+r.id('network/'+n),motif,hostile,members:members.map(p=>p.id),onset,deadline,
      batch:'B-'+r.id('batch/'+n).slice(0,7),active:false,resolved:false};
    members.forEach((p,k)=>{
      p.network=network.id;
      p.harmful=hostile && r.u('culpability/'+p.id)<0.64;
      p.biological=p.harmful && motif.kind==='health';
      p.intent=motif[p.harmful?'hostile':'benign'];
      p.witnessLatent=r.u('witness-latent/'+p.id);
      for(const step of [1,3]) {
        edges.push({id:'E-'+r.id('edge/'+p.id+'/'+step),from:p.id,to:members[(k+step)%8].id,
          relation:step===1?'支付/委托':'交接/同行',batch:network.batch,day:Math.max(1,onset-3+k%3)});
      }
    });
    networks.push(network);
  }
  // Cross-network links are intentionally common; association is not guilt.
  for(let i=0;i<256;i++) edges.push({id:'E-'+r.id('cross/'+i),from:people[i].id,to:people[512+i].id,relation:'同住/曾共事',batch:null,day:1});
  const active=[...networks].sort((a,b)=>r.u('active/'+a.id)-r.u('active/'+b.id)).slice(0,12);
  active.forEach(n=>n.active=true);
  const disasters=[
    {kind:'food',name:'旱季供粮紧缩',day:15,delta:{food:-9,economy:-2}},
    {kind:'health',name:'区域性疾病传播',day:22,delta:{health:-10,trust:-2}},
    {kind:'economy',name:'商路中断',day:29,delta:{economy:-9,gold:-5}},
    {kind:'security',name:'边境军事压力',day:35,delta:{security:-9,infiltration:4}},
    {kind:'trust',name:'难民接纳压力',day:38,delta:{trust:-8,food:-4}},
    {kind:'health',name:'雨季水源污染',day:41,delta:{health:-7,food:-3}}
  ].map((d,i)=>({...d,day:d.day+Math.floor(r.u('disasterday/'+i)*3)-1,severity:0.8+r.u('disasterseverity/'+i)*0.4}));
  const truth=people.map(p=>[p.id,p.network,p.harmful,p.biological]);
  return {people,networks,edges,disasters,truthCommit:hex(sha256(JSON.stringify(truth))),
    manifest:{content_version:CONTENT_VERSION,people:people.length,networks:networks.length,edges:edges.length,
      active_networks:active.length,motifs:MOTIFS.length,regions:REGIONS.length,jobs:JOBS.length,
      potential_investigation_observations:people.length*6}};
}
