import React, { useEffect, useMemo, useState } from "react";

const STORE = "mysportzstats.react.v1";
const fresh = () => ({ id: crypto.randomUUID(), createdAt: Date.now(), status:"live", oversLimit:8, innings:1, batting:"Team A", bowling:"Team B", teams:["Team A","Team B"], score:0, wickets:0, legalBalls:0, extras:0, balls:[], batters:[{name:"Batter 1",runs:0,balls:0},{name:"Batter 2",runs:0,balls:0}], striker:0, bowler:"Bowler 1", history:[] });
function safeLoad(){ try { const x=JSON.parse(localStorage.getItem(STORE)||"{}"); return { current:x.current||fresh(), matches:Array.isArray(x.matches)?x.matches:[] }; } catch { return {current:fresh(),matches:[]}; } }
function overs(balls){ return Math.floor(balls/6)+"."+(balls%6); }
function App(){
 const [data,setData]=useState(safeLoad);
 const [tab,setTab]=useState("Scorer");
 const [teamA,setTeamA]=useState(data.current.teams?.[0]||"Team A");
 const [teamB,setTeamB]=useState(data.current.teams?.[1]||"Team B");
 const [limit,setLimit]=useState(data.current.oversLimit||8);
 const [notice,setNotice]=useState("Ready to score");
 const match=data.current;
 useEffect(()=>{ try{localStorage.setItem(STORE,JSON.stringify(data));}catch(e){setNotice("Storage full — export your history to keep a backup.");} },[data]);
 const runRate=match.legalBalls?((match.score/match.legalBalls)*6).toFixed(2):"0.00";
 const lastBalls=match.balls.slice(-12);
 const update=(fn)=>setData(old=>({...old,current:fn({...old.current})}));
 function addBall(kind){
  if(match.status!=="live")return;
  const runs=kind==="W"||kind==="WD"||kind==="NB"?0:Number(kind);
  update(m=>{
   const legal=!["WD","NB"].includes(kind);
   const total=runs+(kind==="WD"||kind==="NB"?1:0);
   const ball={id:crypto.randomUUID(),kind,runs:total,legal,at:Date.now(),over:overs(m.legalBalls)};
   m.score+=total; if(kind==="W")m.wickets=Math.min(10,m.wickets+1);
   if(kind==="WD"||kind==="NB")m.extras++;
   if(legal){m.legalBalls++;m.batters[m.striker].balls++;if(kind!=="W")m.batters[m.striker].runs+=total;if(total%2)m.striker=1-m.striker;}
   m.balls.push(ball);m.history.push({score:m.score,wickets:m.wickets,legalBalls:m.legalBalls,extras:m.extras,batters:structuredClone(m.batters),striker:m.striker,balls:m.balls.length});
   if(m.legalBalls>=m.oversLimit*6||m.wickets>=10)m.status="innings-complete";
   return m;
  });
  setNotice(kind==="W"?"Wicket recorded":kind==="4"?"FOUR!":kind==="6"?"SIX!":"Ball saved");
 }
 function undo(){update(m=>{const prev=m.history.pop();if(!prev)return m;m.score=prev.score;m.wickets=prev.wickets;m.legalBalls=prev.legalBalls;m.extras=prev.extras;m.batters=prev.batters;m.striker=prev.striker;m.balls.pop();m.status="live";return m;});setNotice("Last delivery undone");}
 function finish(){setData(old=>{const completed={...old.current,status:"completed",completedAt:Date.now()};const matches=[completed,...old.matches.filter(x=>x.id!==completed.id)].slice(0,100);return {current:fresh(),matches};});setNotice("Match saved to local history");}
 function start(){const a=teamA.trim()||"Team A",b=teamB.trim()||"Team B";setData(old=>({...old,current:{...fresh(),teams:[a,b],batting:a,bowling:b,oversLimit:Math.max(1,Math.min(50,Number(limit)||8))}}));setTab("Scorer");setNotice("New match started");}
 function exportHistory(){const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),...data},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="mysportzstats-backup.json";a.click();URL.revokeObjectURL(url);}
 const stats=useMemo(()=>{const all=[...data.matches,...(match.balls.length?[match]:[])];return {matches:all.length,runs:all.reduce((n,m)=>n+(m.score||0),0),wickets:all.reduce((n,m)=>n+(m.wickets||0),0)}},[data,match]);
 return <main className="shell">
  <header className="topbar"><div className="brand"><div className="brand-mark">M</div><div><strong>MySportzStats</strong><small>CRICKET CONTROL ROOM</small></div></div><span className="live-tag"><i/> REACT EDITION</span></header>
  <nav className="tabs">{["Scorer","History","Stats","Squads"].map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</nav>
  {tab==="Scorer"&&<><section className="score-hero"><div className="match-meta"><span className="live-label">● {match.status==="live"?"LIVE MATCH":match.status.toUpperCase()}</span><span>{match.oversLimit} OVERS</span></div><div className="teams"><div><small>{match.batting}</small><strong>{match.score}<em>/{match.wickets}</em></strong><span>{overs(match.legalBalls)} overs</span></div><b>VS</b><div><small>{match.bowling}</small><strong className="opponent">—</strong><span>Innings {match.innings}</span></div></div><div className="rate-row"><span>CRR <b>{runRate}</b></span><span>EXTRAS <b>{match.extras}</b></span><span>OVERS LEFT <b>{Math.max(0,match.oversLimit-Math.floor(match.legalBalls/6))}</b></span></div></section>
   <section className="card"><div className="section-head"><h2>Batting</h2><span className="muted">* on strike</span></div>{match.batters.map((p,i)=><div className="player-line" key={i}><span>{p.name} {match.striker===i&&<b className="star">*</b>}</span><strong>{p.runs} <small>({p.balls})</small></strong></div>)}<div className="player-line"><span>Bowler</span><strong>{match.bowler}</strong></div></section>
   <section className="card"><div className="section-head"><h2>Record delivery</h2><button className="text-btn" onClick={undo} disabled={!match.balls.length}>Undo last</button></div><div className="run-grid">{["0","1","2","3","4","6","WD","NB","W"].map(k=><button key={k} className={"run "+(k==="W"?"wicket":k==="4"?"four":k==="6"?"six":"")} onClick={()=>addBall(k)} disabled={match.status!=="live"}>{k==="WD"?"Wide":k==="NB"?"No ball":k==="W"?"Wicket":k}</button>)}</div><p className="hint">{notice}</p></section>
   <section className="card"><div className="section-head"><h2>Recent balls</h2><span className="muted">{match.balls.length} total</span></div><div className="ball-strip">{lastBalls.map((b,i)=><span key={b.id} className={b.kind==="W"?"ball-w":b.kind==="4"?"ball-four":b.kind==="6"?"ball-six":""}>{b.kind==="WD"?"Wd":b.kind==="NB"?"Nb":b.kind}</span>)}</div><button className="primary full" onClick={finish} disabled={!match.balls.length}>Finish innings & save match</button></section>
   <section className="card setup"><div className="section-head"><h2>New match setup</h2></div><div className="form-grid"><label>Team A<input value={teamA} onChange={e=>setTeamA(e.target.value)}/></label><label>Team B<input value={teamB} onChange={e=>setTeamB(e.target.value)}/></label><label>Overs<input type="number" min="1" max="50" value={limit} onChange={e=>setLimit(e.target.value)}/></label></div><button className="secondary full" onClick={start}>Start new match</button></section>
  </>}
  {tab==="History"&&<section className="card"><div className="section-head"><h2>Match history</h2><button className="text-btn" onClick={exportHistory}>Export backup</button></div>{data.matches.length===0?<div className="empty"><b>No completed matches yet</b><span>Finished matches will be saved on this device automatically.</span></div>:data.matches.map(m=><article className="history-row" key={m.id}><div><b>{m.teams?.[0]} vs {m.teams?.[1]}</b><small>{new Date(m.completedAt||m.createdAt).toLocaleString()}</small></div><strong>{m.score}/{m.wickets}<small>{overs(m.legalBalls)} ov</small></strong></article>)}</section>}
  {tab==="Stats"&&<section className="card"><h2>Tournament snapshot</h2><div className="stat-grid"><div><small>MATCHES</small><b>{stats.matches}</b></div><div><small>RUNS</small><b>{stats.runs}</b></div><div><small>WICKETS</small><b>{stats.wickets}</b></div></div><p className="hint">Stats are calculated from saved local match records and the current innings.</p></section>}
  {tab==="Squads"&&<section className="card"><h2>Squad management</h2><p className="muted">Player editing and full squad selection are being added in the next migration stage. Current scorer starts with two editable batter slots and a bowler slot.</p></section>}
  <footer>Local autosave enabled · This device only <span>v0.1 React foundation</span></footer>
 </main>;
}
export default App;