import { language, locales, localizePage, t } from './i18n.js';

localizePage();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
document.addEventListener('click', event => {
  const button = event.target.closest('button:not(:disabled), nav a');
  if (!button || reducedMotion.matches || typeof button.animate !== 'function') return;
  button.animate([
    {boxShadow:'0 0 0 0 #6bd7ffb0',transform:'scale(.96)'},
    {boxShadow:'0 0 0 9px #6bd7ff00',transform:'scale(1)'}
  ],{duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
});
const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = t(text);
  if (cls) element.className = cls;
  return element;
};
const attach = (element, ...children) => { element.append(...children); return element; };
const icon = name => {
  const element = node('i');
  element.dataset.lucide = name;
  element.setAttribute('aria-hidden','true');
  return element;
};
const icons = () => window.lucide?.createIcons();
const formatDate = value => value ? new Intl.DateTimeFormat(locales[language],{
  dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Baku'
}).format(new Date(value)) : '—';
const money = value => new Intl.NumberFormat(locales[language],{style:'currency',currency:'USD'}).format(Number(value || 0)/100);

async function api(action, params = {}, body) {
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch('/api/control?' + query, body === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && action !== 'login') location.replace('/login');
    throw new Error(data.error);
  }
  return data;
}

function bindForm(form, submit, onError) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit],button:not([type])');
    button.disabled = true;
    try { await submit(Object.fromEntries(new FormData(form))); }
    catch (error) { onError(error.message); }
    finally { button.disabled = false; }
  });
}

if ($('login-form')) {
  bindForm($('login-form'), async fields => {
    $('login-status').textContent = '';
    await api('login',{},fields);
    location.replace('/dashboard');
  }, message => { $('login-status').textContent = t(message); });
} else {
  start();
}

function start() {
  const routes = [
    ['dashboard','Dashboard','layout-dashboard'],['telegram','Telegram Bot','send'],['users','Users','users-round'],
    ['affiliate','Affiliate','link'],['signals','Signals','chart-no-axes-combined'],['ai-analysis','AI Analysis','brain-circuit'],
    ['market-data','Market Data','database'],['analytics','Analytics','chart-column'],['logs','System Logs','list'],
    ['settings','Settings','settings']
  ];
  const view = location.pathname.split('/').filter(Boolean)[0] || 'dashboard';
  const current = routes.find(route => route[0] === view) || routes[0];
  const content = $('content');
  let filters = {};
  let page = 0;
  let request = 0;
  let toastTimer;
  let charts = [];

  function toast(message) {
    $('toast').textContent = t(message);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
  }

  function button(text, action, disabled = false) {
    const element = node('button',text);
    element.type = 'button';
    element.disabled = disabled;
    element.addEventListener('click',action);
    return element;
  }

  for (const [path,label,image] of routes) {
    const link = attach(node('a'),icon(image),node('span',label,'nav-label'));
    link.href = '/' + path;
    link.title = t(label);
    link.setAttribute('aria-label',t(label));
    if (path === view) link.setAttribute('aria-current','page');
    $('nav').append(link);
  }
  $('breadcrumb').textContent = t(current[1]);
  const clockDate = new Intl.DateTimeFormat(locales[language],{
    day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Baku'
  });
  const bakuCalendar = new Intl.DateTimeFormat('en-GB',{
    day:'numeric',month:'numeric',year:'numeric',timeZone:'Asia/Baku'
  });
  const months = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avqust','sentyabr','oktyabr','noyabr','dekabr'];
  function formatClockDate(now) {
    if (language !== 'az') return clockDate.format(now);
    const parts = Object.fromEntries(bakuCalendar.formatToParts(now).map(({type,value})=>[type,value]));
    return Number(parts.day)+' '+months[Number(parts.month)-1]+' '+parts.year;
  }
  const clockTime = new Intl.DateTimeFormat(locales[language],{
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:'Asia/Baku'
  });
  const zone = {az:'Bakı',tr:'Bakü',en:'Baku'}[language];
  function updateClock() {
    const now = new Date();
    $('clock').dateTime = now.toISOString();
    $('clock-time').textContent = clockTime.format(now);
    $('clock-date').textContent = formatClockDate(now)+' · '+zone;
  }
  updateClock();
  setInterval(updateClock,1000);
  $('logout').onclick = async () => {
    try { await api('logout',{},{}); location.replace('/login'); }
    catch (error) { toast(error.message); }
  };
  const layout = document.querySelector('.layout');
  const mobile = matchMedia('(max-width:760px)');
  function drawer(open) {
    layout.classList.toggle('drawer',open);
    $('scrim').hidden = !open;
    $('menu').setAttribute('aria-expanded',String(open));
    if (open) $('nav').querySelector('[aria-current=page]')?.focus();
  }
  function syncMenu() {
    drawer(false);
    $('menu').setAttribute('aria-expanded',String(!mobile.matches && !layout.classList.contains('collapsed')));
  }
  mobile.addEventListener('change',syncMenu);
  syncMenu();
  $('menu').onclick = () => {
    if (mobile.matches) drawer(!layout.classList.contains('drawer'));
    else $('menu').setAttribute('aria-expanded',String(!layout.classList.toggle('collapsed')));
  };
  function closeDrawer() { drawer(false); $('menu').focus(); }
  $('scrim').onclick = closeDrawer;
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && layout.classList.contains('drawer')) closeDrawer();
  });

  const panel = (title, ...children) => attach(node('section',null,'panel'),node('h2',title),...children);
  const empty = text => node('p',text,'empty');
  const grid = (cls,...children) => attach(node('div',null,cls),...children);
  const pill = (text,cls='') => attach(node('span',null,'pill '+cls),node('span',null,'dot'),document.createTextNode(t(text)));
  const row = (label,value) => attach(node('div',null,'row'),node('span',label),value instanceof Node ? value : node('strong',value));
  const stats = entries => grid('metric-grid',...entries.map(([label,value,image]) =>
    attach(node('div',null,'metric'),attach(node('span',null,'metric-icon'),icon(image)),node('span',label),node('strong',value))));
  const direction = value => pill(value,value === 'AL' ? 'good' : value === 'SAT' ? 'bad' : 'wait');
  const statuses = [['','All'],['Pending','Pending'],['Verified','Verified'],['Rejected','Rejected']];
  const outcomes = [['','All'],['Pending','Pending'],['Win','Win'],['Loss','Loss'],['Void','Void']];

  function table(headings,rows,message) {
    if (!rows.length) return empty(message);
    const table = node('table');
    const header = table.createTHead().insertRow();
    for (const title of headings) {
      const th = node('th',title);
      th.scope = 'col';
      header.append(th);
    }
    const body = table.createTBody();
    for (const cells of rows) {
      const tr = body.insertRow();
      for (const value of cells) {
        const td = tr.insertCell();
        if (value instanceof Node) td.append(value);
        else td.textContent = value ?? '—';
      }
    }
    return attach(node('div',null,'table-scroll'),table);
  }

  function chart(rows,series,message) {
    if (!rows.length) return node('div',message,'chart chart-empty');
    if (!window.Chart) return table(['Period',...series.map(([label])=>label)],
      rows.map(r=>[r.day,...series.map(([,key])=>r[key])]),message);
    const canvas = node('canvas');
    canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label',series.map(([label])=>label).join(', ') + ' by period');
    const container = attach(node('div',null,'chart'),canvas);
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      charts.push(new Chart(canvas,{
        type:'bar',data:{ labels:rows.map(r=>r.day), datasets:series.map(([label,key,color])=>({
          label:t(label),data:rows.map(r=>Number(r[key])),backgroundColor:color,borderRadius:4
        })) },
        options:{ responsive:true,maintainAspectRatio:false,
          animation:matchMedia('(prefers-reduced-motion: reduce)').matches ? false : {duration:250},
          plugins:{legend:{labels:{color:'#c5d4eb'}}},
          scales:{x:{ticks:{color:'#a5b3c9'},grid:{display:false}},y:{beginAtZero:true,ticks:{color:'#a5b3c9'},grid:{color:'#243149'}}}
        }
      }));
    });
    return container;
  }
  const performance = [['Wins','wins','#22c55e'],['Losses','losses','#ef4444']];

  function commissionPicker(label, name, options, value) {
    const selected = options.find(([key])=>key === value) ?? options[0];
    const input = node('input');
    input.type = 'hidden';
    input.name = name;
    input.value = selected[0];
    const caption = node('span',selected[1]);
    const heading = node('span',label,'commission-label');
    heading.id = 'commission-label';
    caption.id = 'commission-selected';
    const summary = attach(node('summary'),caption,node('span','⌄','commission-chevron'));
    summary.setAttribute('aria-labelledby','commission-label commission-selected');
    const menu = node('div',null,'commission-options');
    const picker = attach(node('details',null,'commission-picker'),summary,menu);
    for (const [key,text] of options) {
      const option = button(text,()=>{
        input.value = key;
        caption.textContent = t(text);
        for (const item of menu.children) item.setAttribute('aria-pressed',String(item === option));
        picker.open = false;
        summary.focus();
      });
      option.setAttribute('aria-pressed',String(key === selected[0]));
      menu.append(option);
    }
    picker.addEventListener('keydown',event=>{
      if (event.key === 'Escape' && picker.open) {
        event.preventDefault();
        event.stopPropagation();
        picker.open = false;
        summary.focus();
      }
    });
    picker.addEventListener('focusout',event=>{
      if (!picker.contains(event.relatedTarget)) picker.open = false;
    });
    return attach(node('div',null,'commission-field'),heading,input,picker);
  }

  function field([label,name,type,options],values) {
    if (name === 'model' && options) return commissionPicker(label,name,options,values[name]);
    let input;
    if (options) {
      input = node('select');
      for (const [value,text] of options) input.append(new Option(t(text),value));
    } else if (type === 'textarea') input = node('textarea');
    else { input = node('input'); input.type = type || 'text'; }
    input.name = name;
    input.value = values[name] ?? options?.[0]?.[0] ?? '';
    return attach(node('label',label),input);
  }
  function filterBar(definitions) {
    const form = node('form',null,'toolbar filters');
    definitions.forEach(def => form.append(field(def,filters)));
    const apply = node('button','Apply filters');
    form.append(apply,button('Reset',()=>{ filters={};page=0;load(); }));
    form.addEventListener('submit',event=>{
      event.preventDefault();
      filters=Object.fromEntries(new FormData(form));
      page=0;
      load();
    });
    return form;
  }
  function pager(more) {
    return grid('toolbar',button('Previous',()=>{page--;load();},page===0),
      node('span',t('Page')+' '+(page+1),'muted'),button('Next',()=>{page++;load();},!more));
  }
  const signalFilters = [['Asset','asset'],['Duration (min)','period','number']];
  function edit(title,definitions,values,route,section,disabled) {
    const form = node('form');
    definitions.forEach(def=>form.append(field(def,values)));
    const save = node('button','Save','primary');
    save.disabled = disabled;
    form.append(save);
    if (disabled) form.append(node('p','Connect PostgreSQL to save changes.','muted'));
    bindForm(form,async data=>{
      await api(route,{},section ? {...data,section} : data);
      toast('Settings saved.');
      await load();
    },toast);
    return panel(title,form);
  }
  const affiliateFields = [
    ['Affiliate URL','link','url'],
    ['Commission model','model',null,[['','Select model'],['not-loss-linked','Not linked to user losses'],['loss-linked','Linked to user losses']]],
    ['User disclosure','disclosure','textarea']
  ];
  function details(user) {
    const modal = $('dialog');
    const form = node('form');
    const statusField = field(['Affiliate status','status',null,statuses.slice(1)],user);
    const access = field(['Access','enabled',null,[['false','Suspended'],['true','Active']]],{enabled:String(user.enabled)});
    const statusInput = statusField.querySelector('select');
    const accessInput = access.querySelector('select');
    const sync = () => {
      accessInput.disabled = statusInput.value !== 'Verified';
      if (accessInput.disabled) accessInput.value = 'false';
    };
    statusInput.onchange = sync;
    sync();
    form.append(statusField,access,node('button','Confirm changes','primary'),button('Cancel',()=>modal.close()));
    bindForm(form,async data=>{
      await api('users',{}, {id:user.telegram_id,status:data.status,enabled:data.enabled==='true'});
      modal.close();
      toast('User access updated.');
      await load();
    },toast);
    $('dialog-body').replaceChildren(node('h2',t('User')+' '+user.telegram_id),node('p',(user.username||t('Username unavailable'))+' · '+formatDate(user.created_at),'muted'),form);
    modal.showModal();
  }

  function dashboard(data) {
    const m = data.metrics;
    const totals = data.performance.reduce((total,r)=>[total[0]+Number(r.wins),total[1]+Number(r.losses)],[0,0]);
    return [
      stats([['Total Users',m.users,'users-round'],['Active Users',m.active,'activity'],['Total Signals',m.signals,'zap'],['Affiliate Revenue',money(m.cents),'wallet']]),
      grid('grid-2',
        panel('Signal Performance',filterBar(signalFilters),chart(data.performance,performance,'No settled signals in the last 30 days.'),row('Wins / Losses',totals.join(' / '))),
        panel('Integration Status',row('Telegram Bot',pill(data.botOnline?'Online':'Offline',data.botOnline?'good':'wait')),row('AI Engine',pill('Not Configured')),
          row('Market Data',pill('Not Configured')),row('Affiliate System',pill(data.database?'Manual verification':'Database offline',data.database?'wait':'')))),
      grid('grid-3',
        panel('Recent Signals',table(['Asset','Direction','Result'],data.signals.map(r=>[r.asset,direction(r.direction),t(r.outcome)]),'No signal records.')),
        panel('Recent Users',table(['Telegram ID','Status'],data.users.map(r=>[r.telegram_id,r.status]),'No registrations.')),
        panel('System Activity',table(['Event','Time'],data.logs.map(r=>[r.event,formatDate(r.at)]),'No activity recorded.')))
    ];
  }

  function botControls(data) {
    const form = node('form');
    const maintenance = node('input');
    maintenance.type = 'checkbox';
    maintenance.checked = Boolean(data.maintenance);
    form.append(attach(node('label',null,'toolbar'),maintenance,document.createTextNode(t('Maintenance mode'))));
    const durations = [3,5,10,15,30,60,180,300,900].map(seconds => {
      const input = node('input');
      input.type = 'checkbox';
      input.checked = data.durations.includes(seconds);
      const label = seconds < 60 ? seconds+' sec' : seconds/60+' min';
      form.append(attach(node('label',null,'toolbar'),input,document.createTextNode(label)));
      return { seconds,input };
    });
    const save = node('button','Save bot controls','primary');
    save.disabled = !data.database;
    form.append(save);
    bindForm(form,async () => {
      await api('settings',{},{
        section:'bot-controls',maintenance:maintenance.checked,
        durations:durations.filter(({input})=>input.checked).map(({seconds})=>seconds)
      });
      toast('Bot controls saved.');
      await load();
    },toast);
    return panel('Bot Controls',form);
  }

  function telegram(data) {
    const logo = document.createElementNS('http://www.w3.org/2000/svg','svg');
    logo.setAttribute('viewBox','0 0 24 24');
    logo.setAttribute('aria-hidden','true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg','path');
    shape.setAttribute('fill','#36aee2');
    shape.setAttribute('d','M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.9 7.7-2 9.4c-.15.67-.55.83-1.1.52l-3-2.22-1.45 1.4c-.16.16-.29.29-.6.29l.22-3.05 5.55-5.02c.24-.22-.05-.34-.37-.12l-6.86 4.32-2.96-.92c-.64-.2-.65-.64.14-.95l11.57-4.46c.54-.2 1 .13.86.8Z');
    logo.append(shape);
    const commands = ['Siqnal Al','Aktivlər','Müddətlər','Hesabım','Qeydiyyat','Statistika','Dəstək'];
    const phone = grid('phone',grid('phone-head',logo,node('strong','Quick Trade AI')),grid('phone-chat',
      node('p','Menu preview · phase 1','message'),grid('phone-commands',...commands.map(c=>node('span',c)))));
    return [grid('grid-2',
      grid('stack',panel('Bot Status',row('Connection',pill(data.online?'Online':data.connected?'Offline':'Not Connected',data.online?'good':'wait')),
        row('Bot username',data.username?'@'+data.username:'—'),row('Registered users',data.users ?? '—'),
        row('Last user activity',formatDate(data.activity)),row('Maintenance',data.maintenance?'On':'Off')),
      botControls(data),
      panel('Bot Error Log',table(['Time','Error'],data.errors.map(error=>[formatDate(error.at),error.message]),'No bot errors recorded.')),
      edit('Telegram Configuration',[['Bot username','username']],{username:data.username},'settings','telegram',!data.database)),
      panel('Telegram Menu Preview',phone))];
  }

  function candles(data) {
    if (!data.candles.length) return node('div','No completed candles for this selection.','chart chart-empty');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 720 220');
    svg.setAttribute('class','market-candles');
    svg.setAttribute('role','img');
    svg.setAttribute('aria-label',data.symbol+' completed candlesticks');
    const low = Math.min(...data.candles.map(c=>Number(c.low)));
    const high = Math.max(...data.candles.map(c=>Number(c.high)));
    const y = value => 204 - 190*(Number(value)-low)/(high-low || 1);
    const step = 700/data.candles.length;
    data.candles.forEach((c,index)=>{
      const group = document.createElementNS(svg.namespaceURI,'g');
      const title = document.createElementNS(svg.namespaceURI,'title');
      title.textContent = c.open_at+' · O '+c.open+' · H '+c.high+' · L '+c.low+' · C '+c.close;
      const x = 10+(index+.5)*step;
      const line = document.createElementNS(svg.namespaceURI,'line');
      const body = document.createElementNS(svg.namespaceURI,'rect');
      const color = Number(c.close)>=Number(c.open) ? '#22c55e' : '#ef4444';
      for (const [key,value] of Object.entries({x1:x,x2:x,y1:y(c.high),y2:y(c.low),stroke:color})) line.setAttribute(key,value);
      for (const [key,value] of Object.entries({x:x-step*.29,y:Math.min(y(c.open),y(c.close)),
        width:step*.58,height:Math.max(1,Math.abs(y(c.open)-y(c.close))),fill:color})) body.setAttribute(key,value);
      group.append(title,line,body);
      svg.append(group);
    });
    const latest = data.candles.at(-1);
    return attach(node('div'),svg,node('p',t('Latest close')+' '+latest.close+' · '+new Date(latest.open_at).toISOString(),'muted'));
  }

  function market(data) {
    const source = data.providers.find(provider=>provider.provider===data.provider);
    const quality = data.quality;
    const status = value => pill(value,value==='Online'?'good':'wait');
    return [
      panel('Quotes',table(['Asset','Provider','Bid','Ask','Provider time (UTC)','Received (UTC)','Latency','Status'],
        data.quotes.map(q=>[q.symbol,q.provider,q.bid,q.ask,q.event_at?new Date(q.event_at).toISOString():'—',
          q.received_at?new Date(q.received_at).toISOString():'—',q.latency_ms==null?'—':q.latency_ms+' ms',status(q.status)]),
        'Connect PostgreSQL and enable a market provider.')),
      grid('grid-2',
        panel('Candlesticks',filterBar([
          ['Asset','asset',null,[['BTC/USD','BTC/USD'],['XAU/USD','XAU/USD'],['EUR/USD','EUR/USD'],['GBP/USD','GBP/USD']]],
          ['Interval','interval',null,[['60','1m'],['300','5m'],['900','15m'],['3600','1h']]]
        ]),node('p',data.provider+(source?.candle_basis?' · '+source.candle_basis:'')+' · UTC','muted'),candles(data)),
        panel('Data Quality',row('Missing buckets',quality?.gaps ?? '—'),row('Source duplicates',quality?.duplicates ?? '—'),
          row('Checked',formatDate(quality?.checked_at)),node('p','Missing buckets can include scheduled market closures.','muted'))),
      grid('grid-2',
        panel('Data Providers',table(['Provider','Transport','Cadence','Status'],
          data.providers.map(p=>[p.provider,p.transport,p.cadence,status(p.status)]),'No provider configuration available.')),
        panel('Market Error Log',table(['Time','Provider','Scope','Error'],data.errors.map(e=>[
          formatDate(e.at),e.provider,e.scope,e.code
        ]),'No market data errors recorded.')))
    ];
  }

  function sections(data) {
    if (view === 'dashboard') return dashboard(data);
    if (view === 'telegram') return telegram(data);
    if (view === 'users') return [panel('User Directory',filterBar([['ID or username','q'],['Affiliate status','status',null,statuses]]),
      table(['Telegram ID','Username','Registration','Affiliate','Access','Last activity','Actions'],data.rows.map(r=>[
        r.telegram_id,r.username,formatDate(r.created_at),pill(r.status,r.status==='Verified'?'good':'wait'),
        t(r.enabled?'Active':'Suspended'),formatDate(r.last_seen),button('Details',()=>details(r))
      ]),'No users match the filters.'),pager(data.more))];
    if (view === 'affiliate') {
      const r=data.referrals;
      const conversion=Number(r.users) ? (100*Number(r.verified)/Number(r.users)).toFixed(1)+'%' : '—';
      return [stats([['Referrals',r.users,'users'],['Pending',r.pending,'clock'],['Verified',r.verified,'badge-check'],['Conversion',conversion,'percent']]),
        grid('grid-2',edit('Affiliate Link Settings',affiliateFields,data.config,'affiliate',null,!data.database),
          panel('Commission Reports',table(['Telegram ID','Amount','Reference','Date'],data.commissions.map(c=>[c.telegram_id,money(c.cents),c.reference,formatDate(c.at)]),'No confirmed commissions.'))),
        panel('Verification Requests',table(['Telegram ID','Username','Requested','Status','Reviewed by','Action'],
          data.requests.map(request=>[request.telegram_id,request.username,formatDate(request.requested_at),request.status,
            request.reviewed_by,request.status==='Pending'?button('Review',()=>details({
              telegram_id:request.telegram_id,username:request.username,created_at:request.requested_at,status:'Pending',enabled:false
            })):null]),'No verification requests.')),
        panel('Referral Activity',table(['Telegram ID','Status','Registered'],data.activity.map(u=>[u.telegram_id,u.status,formatDate(u.created_at)]),'No referral activity.'))];
    }
    if (view === 'signals') return [panel('Signal Records',filterBar([...signalFilters,['Direction','direction',null,[['','All'],['AL','AL'],['SAT','SAT'],['GÖZLƏ','GÖZLƏ']]],['Result','result',null,outcomes]]),
      table(['Signal ID','Asset','Duration','Direction','Confidence','Created','Expiry','Result','Model'],data.rows.map(r=>[
        r.id,r.asset,r.period+' min',direction(r.direction),r.confidence==null?'—':r.confidence+'%',formatDate(r.at),formatDate(r.expiry),r.outcome,r.model
      ]),'No signal records match the filters.'),pager(data.more))];
    if (view === 'ai-analysis') return [grid('grid-2',panel('AI Engine',row('Status',pill('Not Configured')),row('Active Model','—'),row('Data Quality','—')),
      panel('Model List',empty('No models configured.'))),grid('grid-3',...['Prediction History','Confidence Distribution','Model Performance','Backtest Results'].map(label=>panel(label,empty('Connect an analysis engine to populate this view.'))))];
    if (view === 'market-data') return market(data);
    if (view === 'analytics') return [
      filterBar([['Range','range',null,[['30','30 Days'],['7','7 Days'],['today','Today'],['custom','Custom Range']]],['From','from','date'],['To','to','date']]),
      grid('grid-3',
        panel('User Growth',chart(data.users,[['Registrations','total','#3b82f6']],'No registrations for this range.')),
        panel('Signal Performance',chart(data.performance,performance,'No settled signals for this range.')),
        panel('Affiliate Conversion',chart(data.conversion,[['Registered','total','#3b82f6'],['Currently verified','verified','#22c55e']],'No referral data for this range.')),
        panel('Model Accuracy',chart(data.models,[['Accuracy (%)','accuracy','#06b6d4']],'No model outcomes for this range.')),
        panel('System Uptime',node('div','No uptime monitoring source configured.','chart chart-empty')),
        panel('Revenue Reports',chart(data.revenue,[['Revenue (USD)','revenue','#22c55e']],'No commissions for this range.')))];
    if (view === 'logs') return [panel('Audit Events',filterBar([['Search','q'],['Severity','status',null,[['','All'],['Info','Info'],['Warning','Warning'],['Error','Error']]]]),
      table(['Timestamp','Service','Event','Severity','Message','Actor'],data.rows.map(r=>[formatDate(r.at),r.service,r.event,pill(r.severity),r.message,r.actor]),'No audit events match the filters.'),pager(data.more))];
    const profile = panel('Admin Profile',row('Username',data.actor),row('Role','Administrator'));
    profile.id='profile';
    return [grid('grid-2',edit('General Settings',[['Workspace name','name']],data.config.general || {},'settings','general',!data.database),
      edit('Telegram Settings',[['Bot username','username']],data.config.telegram || {},'settings','telegram',!data.database)),
      grid('grid-2',edit('Affiliate Settings',affiliateFields,data.config.affiliate || {},'settings','affiliate',!data.database),
        panel('Security',row('Session lifetime','1 hour'),row('Authentication','Server-managed'),row('Login limit','10 per 15 min'))),
      grid('grid-3',panel('AI Settings',pill('Not Configured')),panel('Market Data Settings',pill('Not Configured')),profile)];
  }

  async function load() {
    const version = ++request;
    content.setAttribute('aria-busy','true');
    if (!content.querySelector('.page-head')) content.replaceChildren(node('div',null,'skeleton'),node('div',null,'skeleton'));
    try {
      const data = await api(view,{...filters,page});
      if (version!==request) return;
      charts.forEach(chart=>chart.destroy());
      charts=[];
      const header = grid('page-head',attach(node('div'),node('p',t('Operations')+' / '+t(current[1]),'eyebrow'),node('h1',current[1])),button('Refresh',load));
      content.replaceChildren(header,...sections(data));
      if (location.hash === '#profile') $('profile')?.scrollIntoView();
      if (typeof data.database === 'boolean') $('health').replaceWith(Object.assign(pill(data.database?'Database online':'Database offline',data.database?'good':'wait'),{id:'health'}));
      else $('health').replaceWith(Object.assign(pill('Database status unavailable','wait'),{id:'health'}));
      if (view==='dashboard') $('notifications').textContent = data.logs[0]?.message || t('No new activity.');
      icons();
    } catch (error) {
      if (version !== request) return;
      $('health').replaceWith(Object.assign(pill('Data unavailable','bad'),{id:'health'}));
      if (!content.querySelector('.page-head')) content.replaceChildren(panel('Unable to load',node('p',error.message),button('Retry',load)));
      else toast(error.message);
    } finally {
      if (version === request) content.setAttribute('aria-busy','false');
    }
  }
  icons();
  load();
  if (view === 'market-data') {
    setInterval(async () => {
      if (document.hidden || content.getAttribute('aria-busy') === 'true' || content.contains(document.activeElement)) return;
      const version = request;
      try {
        const data = await api(view,filters);
        if (version !== request || content.contains(document.activeElement)) return;
        const header = content.querySelector('.page-head');
        if (header) content.replaceChildren(header,...market(data));
      } catch {
        if (version === request) toast('Market refresh failed. Showing the last successful update.');
      }
    },10000);
  }
}
