(() => {
  const $ = id => document.getElementById(id);
  const COLORS = ["#55d6be","#ffcb69","#ff6b6b","#7aa2ff","#c792ea","#f78fb3","#a3e635","#fb923c"];
  const RU = {
    "Russia":"Россия","United States of America":"США","United States":"США","China":"Китай","Brazil":"Бразилия","India":"Индия","Australia":"Австралия","France":"Франция","South Africa":"ЮАР","Canada":"Канада","Mexico":"Мексика","Argentina":"Аргентина","United Kingdom":"Великобритания","Germany":"Германия","Spain":"Испания","Italy":"Италия","Japan":"Япония","Indonesia":"Индонезия","Saudi Arabia":"Саудовская Аравия","Turkey":"Турция","Egypt":"Египет","Ukraine":"Украина","Poland":"Польша","Norway":"Норвегия","Sweden":"Швеция","Finland":"Финляндия","Iran":"Иран","Pakistan":"Пакистан","South Korea":"Южная Корея","North Korea":"КНДР","Thailand":"Таиланд","Vietnam":"Вьетнам","Nigeria":"Нигерия","Kenya":"Кения","Algeria":"Алжир","Morocco":"Марокко","Peru":"Перу","Chile":"Чили","Colombia":"Колумбия","Kazakhstan":"Казахстан","Mongolia":"Монголия","New Zealand":"Новая Зеландия","Cuba":"Куба","Iraq":"Ирак","Afghanistan":"Афганистан","Greece":"Греция","Romania":"Румыния","Belarus":"Беларусь","Netherlands":"Нидерланды","Belgium":"Бельгия","Switzerland":"Швейцария","Austria":"Австрия","Portugal":"Португалия","Ethiopia":"Эфиопия","Sudan":"Судан","Venezuela":"Венесуэла","Myanmar":"Мьянма","Philippines":"Филиппины","Malaysia":"Малайзия","Iceland":"Исландия"
  };
  const state = {ws:null, id:null, roomCode:null, room:null, selected:null, map:null, geo:null, layers:new Map(), local:false, ready:false, sound:true, toastTimer:null, localResources:100, localArmy:20, localOwner:null, localLog:[]};
  function toast(msg) { const el=$("toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>el.classList.remove("show"),2600); }
  function play(freq=540, duration=.07) { if(!state.sound)return; try { const C=window.AudioContext||window.webkitAudioContext; const c=play.ctx||(play.ctx=new C()); const o=c.createOscillator(),g=c.createGain(); o.frequency.value=freq;o.type="sine";g.gain.value=.045;o.connect(g);g.connect(c.destination);o.start();g.gain.exponentialRampToValueAtTime(.001,c.currentTime+duration);o.stop(c.currentTime+duration); }catch{} }
  function send(obj) { if(state.ws && state.ws.readyState===1) state.ws.send(JSON.stringify(obj)); else toast("Нет подключения к серверу."); }
  function showScreen(name) { $("home").classList.toggle("hidden",name!=="home"); $("game").classList.toggle("hidden",name!=="game"); if(name==="game" && state.map) setTimeout(()=>state.map.invalidateSize(),100); }
  function nameOf(name){return RU[name]||name||"Неизвестная страна";}
  function player(){return state.room?.players?.find(p=>p.id===state.id)||null;}
  function connect() {
    if(state.ws && state.ws.readyState===1) return;
    const protocol=location.protocol==="https:"?"wss:":"ws:";
    state.ws=new WebSocket(`${protocol}//${location.host}`);
    $("connection").textContent="● Подключение…";
    state.ws.onopen=()=>{$("connection").textContent="● Сервер подключён";$("connection").style.color="var(--mint)";};
    state.ws.onclose=()=>{$("connection").textContent="● Нет соединения";$("connection").style.color="var(--muted)";};
    state.ws.onerror=()=>toast("Не удалось подключиться к серверу.");
    state.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handleMessage(m)};
  }
  function handleMessage(m){
    if(m.type==="hello") return;
    if(m.type==="joined"){state.id=m.id;state.roomCode=m.code;$("lobbyCode").textContent=m.code;$("roomCode").value=m.code;$("lobby").classList.remove("hidden");$("lobbyMessage").textContent="Код комнаты: "+m.code;toast("Ты в комнате "+m.code);play(700);}
    else if(m.type==="room"||m.type==="state"){state.room=m.room;renderLobby();if(state.room.status==="playing"){state.local=false;showScreen("game");renderGame();} }
    else if(m.type==="notice"){toast(m.message);play(600,.08);}
    else if(m.type==="error")toast(m.message);
  }
  function renderLobby(){
    if(!state.room)return;
    $("lobbyCode").textContent=state.room.code;
    $("playerList").innerHTML="";
    state.room.players.forEach(p=>{const d=document.createElement("div");d.className="player-chip";d.innerHTML=`<span class="swatch" style="background:${p.color}"></span><div><b>${escapeHtml(p.name)}${p.id===state.room.hostId?" ★":""}</b><small>${p.ready?"ГОТОВ":"ОЖИДАЕТ"}</small></div>`;$("playerList").appendChild(d)});
    $("lobbyMessage").textContent=`Игроков: ${state.room.players.length}/8. ${state.room.players.length<2?"Для запуска нужно минимум 2 игрока.":"Хост может начать матч."}`;
    $("startBtn").disabled=state.id!==state.room.hostId;
    $("startBtn").style.opacity=state.id===state.room.hostId?"1":".45";
    if(state.room.status==="playing")showScreen("game");
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function initMap(){
    if(state.map)return;
    state.map=L.map("map",{worldCopyJump:true,minZoom:2,maxZoom:7,zoomControl:true}).setView([24,5],2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",{attribution:'&copy; OpenStreetMap &copy; CARTO',subdomains:"abcd",maxZoom:19}).addTo(state.map);
    fetch("https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson").then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{state.geo=data;drawCountries()}).catch(()=>toast("Не загрузились границы стран. Проверь интернет."));
  }
  function countryName(feature){const p=feature.properties||{};return p.ADMIN||p.name||p.name_en||p.SOVEREIGNT||"Страна";}
  function ownerId(country){return state.room?.state?.countries?.[country]||null;}
  function colorFor(country){
    const owner=ownerId(country);
    if(owner){const p=state.room.players.find(x=>x.id===owner);if(p)return p.color;}
    if(state.local&&country===state.localOwner)return COLORS[0];
    return "#526b81";
  }
  function styleFeature(feature){const n=countryName(feature),owner=ownerId(n);return {color:state.selected===n?"#fff0ad":"#9bb0c2",weight:state.selected===n?2:0.65,fillColor:colorFor(n),fillOpacity:owner|| (state.local&&n===state.localOwner)?.8:.34};}
  function drawCountries(){
    if(!state.geo||!state.map)return;
    if(state.layers.size){state.layers.forEach(l=>state.map.removeLayer(l));state.layers.clear();}
    const layer=L.geoJSON(state.geo,{style:styleFeature,onEachFeature:(feature,lyr)=>{
      const n=countryName(feature);state.layers.set(n,lyr);
      lyr.on("click",()=>{state.selected=n;updateMapStyle();$("mapHint").textContent=nameOf(n)+" — выбрана";play(450);});
      lyr.bindTooltip(nameOf(n),{sticky:true,direction:"top"});
    }}).addTo(state.map);
    state.worldLayer=layer;updateMapStyle();
  }
  function updateMapStyle(){if(state.worldLayer)state.worldLayer.setStyle(f=>styleFeature(f));}
  function renderGame(){
    if(!state.local&&!state.room)return;
    initMap();
    const p=player();
    $("countryName").textContent=state.local?nameOf(state.localOwner):nameOf(p?.country);
    $("resources").textContent=state.local?state.localResources:(state.room.state?.resources?.[state.id]??0);
    $("army").textContent=state.local?state.localArmy:(state.room.state?.armies?.[state.id]??0);
    $("dayLabel").textContent="ДЕНЬ "+(state.local?Math.floor(state.localLog.length/2):(state.room.state?.turn||0));
    $("recruitBtn").disabled=false;$("upgradeBtn").disabled=false;$("attackBtn").disabled=!state.selected;
    const stats=$("playerStats");stats.innerHTML="";
    const players=state.local?[{id:"local",name:"Ты",color:COLORS[0]}]:(state.room?.players||[]);
    players.forEach(q=>{const row=document.createElement("div");row.className="player-row";const res=state.local?state.localResources:(state.room.state?.resources?.[q.id]||0);const army=state.local?state.localArmy:(state.room.state?.armies?.[q.id]||0);row.innerHTML=`<i class="swatch" style="background:${q.color}"></i><span>${escapeHtml(q.name)}</span><b>${army} ⚔ · ${res} ◈</b>`;stats.appendChild(row)});
    const logs=state.local?state.localLog:(state.room.state?.log||[]);
    $("eventLog").innerHTML=logs.slice(0,12).map(e=>`<div class="event">${escapeHtml(e.text)}</div>`).join("")||'<div class="event">Пока тихо…</div>';
    updateMapStyle();
  }
  function act(action){
    if(state.local){
      if(action==="recruit"){if(state.localResources<25)return toast("Нужно 25 ресурсов.");state.localResources-=25;state.localArmy+=10;state.localLog.unshift({text:"Ты нанял 10 отрядов"});}
      if(action==="upgrade"){if(state.localResources<40)return toast("Нужно 40 ресурсов.");state.localResources-=40;state.localIncome=(state.localIncome||8)+3;state.localLog.unshift({text:"Экономика улучшена"});}
      if(action==="attack"){if(!state.selected||state.selected===state.localOwner)return toast("Выбери другую страну.");if(state.localResources<15)return toast("Нужно 15 ресурсов.");state.localResources-=15;state.localLog.unshift({text:`Ты начал кампанию против ${nameOf(state.selected)}`});toast("В локальном режиме страна отмечена как захваченная.");state.localOwner=state.selected;state.localLog.unshift({text:`Захвачена страна: ${nameOf(state.selected)}`});}
      renderGame();return;
    }
    send({type:"action",action,country:state.selected});
  }
  function startLocal(){
    state.local=true;state.room=null;state.id=null;state.localOwner="France";state.localResources=100;state.localArmy=20;state.localIncome=8;state.localLog=[{text:"Локальная кампания началась"}];showScreen("game");initMap();renderGame();
    if(state.localTimer)clearInterval(state.localTimer);
    state.localTimer=setInterval(()=>{state.localResources=Math.min(9999,state.localResources+state.localIncome);state.localArmy=Math.min(999,state.localArmy+1);state.localLog.unshift({text:"Экономика принесла ресурсы, армия пополнена"});state.localLog=state.localLog.slice(0,30);renderGame();},5000);
  }
  $("createBtn").onclick=()=>{connect();setTimeout(()=>send({type:"create",name:$("playerName").value}),100);play();};
  $("joinBtn").onclick=()=>{const code=$("roomCode").value.trim();if(!code)return toast("Введи код комнаты.");connect();setTimeout(()=>send({type:"join",code,name:$("playerName").value}),100);play();};
  $("soloBtn").onclick=()=>{startLocal();play();};
  $("readyBtn").onclick=()=>{state.ready=!state.ready;send({type:"ready",value:state.ready});$("readyBtn").textContent=state.ready?"✓ Ты готов":"✓ Готов";play();};
  $("startBtn").onclick=()=>send({type:"start"});
  $("copyCode").onclick=async()=>{try{await navigator.clipboard.writeText(state.roomCode);toast("Код скопирован");}catch{toast("Код комнаты: "+state.roomCode)}};
  $("recruitBtn").onclick=()=>act("recruit");$("upgradeBtn").onclick=()=>act("upgrade");$("attackBtn").onclick=()=>act("attack");
  $("exitBtn").onclick=()=>{if(state.localTimer)clearInterval(state.localTimer);if(state.ws)send({type:"leave"});state.local=false;state.room=null;state.selected=null;showScreen("home");$("lobby").classList.add("hidden");if(state.ws){state.ws.close();state.ws=null;}};
  $("soundBtn").onclick=()=>{state.sound=!state.sound;$("soundBtn").textContent=state.sound?"♫":"♪";toast(state.sound?"Звук включён":"Звук выключен");if(state.sound)play();};
  connect();
})();