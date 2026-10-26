/* Stable field identifiers found in the supplied 质检34.html. */
(function(root) {
  const models = [
    ['doubao','豆包 turbo 2.1'],
    ['gpt56','GPT-5.6-sol（中/Medium及以上推理）'],
    ['claude','Claude opus 4.6（Medium及以上推理）'],
    ['arena1','arena 随机模型 1'],['arena2','arena 随机模型 2']
  ];
  const f = (id,label,type='text',extra={}) => ({id,label,type,...extra});
  const fields = [
    f('question-type-radio','题目类型','radio',{options:[['openRecommendation','开放推荐'],['analysisDecision','分析决策'],['howTo','How-to']],section:'author'}),
    f('question-domain-select','题目领域','select',{free:true,options:['生活娱乐','理工科（非计算机/数理）','计算机','数理','人文社科','医学','商业财经'],section:'author'}),
    f('question-input','题目Prompt','text',{max:5000,rows:5,section:'author',placeholder:'请编写本次出题任务的题目Prompt'}),
    f('insight-input','出题说明（关键洞察 insight）','text',{max:5000,rows:6,section:'author'}),
    f('insight-description-input','决定性核心考点','text',{max:5000,rows:6,section:'author'}),
    f('non-decisive-insight-description-input','非决定性核心考点','text',{max:5000,rows:4,section:'author'}),
    ...models.flatMap(([key,name])=>[
      ...(key.startsWith('arena')?[f(`${key}-name-input`,'模型名称','input',{max:100,section:key})]:[]),
      f(`${key}-markdown-input`,'Markdown 回复','text',{rows:10,section:key,placeholder:`请粘贴${name}的 Markdown 回复`}),
      f(`${key}-achievement-select`,'决定性核心考点是否达成','select',{options:['达成','未达成'],section:key}),
      f(`${key}-achievement-note-input`,'达成性备注','text',{max:3000,rows:4,section:key,placeholder:'请说明达成或未达成的依据'}),
      f(`${key}-screenshot-file-input`,'回复截图','file',{section:key})
    ]),
    f('ranking-reason-input','决定性+非决定性核心考点的达成性排序说明','text',{max:3000,rows:5,section:'ranking'})
  ];
  const overwriteMode=row=>['none','all','later'].includes(row?.overwriteMode)?row.overwriteMode:row?.overwrite===true?'all':'none';
  root.QFSchema = {models,fields,version:2,overwriteMode};
})(globalThis);
