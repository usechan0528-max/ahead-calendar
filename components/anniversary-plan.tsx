'use client';
import { useState } from 'react';
import type { Recommendation } from '@/lib/preparation-recommendations';
export const ANNIVERSARY_STEPS = [
  {id:'celebration-gift',label:'축하 방법 정하기',days:14},
  {id:'celebration-booking',label:'필요한 예약 확인',days:7},
  {id:'celebration-message',label:'마음 전할 준비',days:0},
] as const;
export function AnniversaryPlan({items,preparations,busy,onAdopt,onChecklist}: {
  items:Recommendation[]; preparations:Array<{id?:number;meta:string}>; busy:boolean;
  onAdopt:(id:string,timing:string)=>void; onChecklist:()=>void;
}) {
  const [days,setDays] = useState<Record<string,string>>({});
  const steps = ANNIVERSARY_STEPS.flatMap(step=>{const item=items.find(item=>item.id===step.id&&item.state!=='dismissed');return item?[{...step,item}]:[];});
  if (!steps.length) return null;
  return <section className="anniversary-plan" aria-label="기념일 단계별 준비"><h3>기념일까지, 필요한 준비만</h3><p>원하는 단계의 시점을 바꾸고 하나씩 담으세요. 시점은 메모이며 실제 마감이나 자동 알림이 아니에요.</p>
    <ol>{steps.map((step,index)=>{
      const value=days[step.id]??String(step.days); const valid=/^\d{1,3}$/.test(value)&&Number(value)<=365;
      const saved=preparations.find(item=>item.id===step.item.preparationId);
      return <li key={step.id}><span className="anniversary-step-number">{index+1}</span><div><h4>{step.label}</h4><p>{step.item.title}</p>
        {step.item.state==='added' ? <><p>담아 둔 준비 · {saved?.meta ?? '기존 준비 시점 유지'}</p><button type="button" className="text-button" onClick={onChecklist}>체크리스트에서 확인·수정</button></> : step.item.state==='removed' ? <p>삭제한 준비예요. 자동으로 다시 담지 않아요.</p> : <>
          <label>준비 시점 메모<input aria-label={`${step.label} 며칠 전`} type="number" min="0" max="365" value={value} disabled={busy} onChange={event=>setDays(previous=>({...previous,[step.id]:event.target.value}))}/>일 전 <small>0은 당일</small></label>
          <button type="button" className="text-button" disabled={busy||!valid} onClick={()=>onAdopt(step.id,`${Number(value)===0?'당일':`${Number(value)}일 전`} · 준비 메모`)}>이 단계 담기</button>
        </>}
      </div></li>;
    })}</ol><p>저장 후 체크리스트에서 내용을 수정할 수 있어요. 알림은 아래 추천 알림 또는 일정의 ‘알림’에서 따로 선택해 주세요.</p>
  </section>;
}
