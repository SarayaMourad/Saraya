import { prisma } from "./prisma";

const r3=(v:number)=>Math.round((v+Number.EPSILON)*1000)/1000;
const pct=(current:number,previous:number)=>previous===0?null:r3((current-previous)/Math.abs(previous)*100);
const n=(v:any)=>Number(v||0);
async function shop(){ const s=await prisma.shop.findFirst(); if(!s) throw new Error("Aucun commerce Saraya configuré."); return s; }
function since(days:number){ return new Date(Date.now()-Math.max(1,Math.min(365,days))*86400000); }
const sumMoney=(values:any[])=>r3(values.reduce((a,v)=>a+Math.round(n(v)*1000),0)/1000);
const recorded=(shopId:string,from:Date,to?:Date)=>({shopId,status:"RECORDED",recordedAt:{gte:from,...(to?{lt:to}:{})}} as const);

export const scenarioCalculations = {
 price(currentPrice:number,newPrice:number,units:number,costPerUnit?:number){
  if (![currentPrice,newPrice,units].every(Number.isFinite)||currentPrice<0||newPrice<0||units<0) throw new Error("Paramètres de simulation invalides");
  return {kind:"SIMULATION_NOT_ACTUAL",units,oldRevenue:r3(currentPrice*units),newRevenue:r3(newPrice*units),revenueDifference:r3((newPrice-currentPrice)*units),profitDifference:null,assumptions:["Quantité vendue inchangée","Demande et coûts fixes non modélisés"],warning:"Une hausse du chiffre d'affaires ne garantit pas une hausse du bénéfice."};
 },
 loan(principal:number,annualRatePercent:number,months:number){
  if(![principal,annualRatePercent,months].every(Number.isFinite)||principal<0||annualRatePercent<0||!Number.isInteger(months)||months<1||months>600)throw new Error("Paramètres de prêt invalides");
  const r=annualRatePercent/1200;const payment=r===0?principal/months:principal*r/(1-Math.pow(1+r,-months));
  return {kind:"SIMULATION_NOT_ACTUAL",monthlyPayment:r3(payment),totalRepayment:r3(payment*months),interest:r3(payment*months-principal),assumptions:["Taux fixe","Mensualités constantes","Frais et assurance exclus"],warning:"Simulation de remboursement, pas une décision d'octroi ni une preuve de capacité de paiement."};
 }
};

export const analyticsToolDefinitions:any[] = [
 {type:"function",function:{name:"analyze_business_question",description:"Dossier transversal sur le café: périodes enregistrées, ventes, caisse, dépenses, corrections et produits dominants. Pour les diagnostics généraux, risques, opportunités et financement.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:180}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"simulate_business_decision",description:"Simulations sans écriture: changement de prix ou mensualités d'un emprunt. Ne prédit pas la demande ni l'approbation bancaire.",parameters:{type:"object",properties:{scenario:{type:"string",enum:["price","loan"]},currentPrice:{type:"number"},newPrice:{type:"number"},units:{type:"number"},principal:{type:"number"},annualRatePercent:{type:"number"},months:{type:"integer"}},required:["scenario"],additionalProperties:false}}},
 {type:"function",function:{name:"analyze_opportunities",description:"Détecte concentrations des ventes, évolutions par produit, écarts répétés et limites de données. Analyses prudentes et actionnables.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:180}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"analyze_financial_health",description:"Distingue ventes ticket, cash caisse, recette finale, dépenses, salaires, corrections et données nécessaires au bénéfice net.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:365}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"get_last_shift",description:"Retourne les faits vérifiés détaillés du dernier shift enregistré: recette, caisse, ticket, ventes, stock physique, corrections et métriques. À utiliser pour une question factuelle sur le dernier shift.",parameters:{type:"object",properties:{},additionalProperties:false}}},
 {type:"function",function:{name:"analyse_last_shift_expert",description:"Analyse déterministe complète du dernier shift. Retourne dans un seul résultat toutes les données nécessaires à une analyse propriétaire: ventes détaillées et classements, consommations physiques, corrections classées, café, chicha, caisse/dépenses et ratios calculables. Utiliser pour les demandes larges comme analyse le dernier shift, que dois-je surveiller, qu'est-ce qui s'est passé.",parameters:{type:"object",properties:{},additionalProperties:false}}},
 {type:"function",function:{name:"analyse_sales",description:"Analyse déterministe des ventes sur une période: quantités et chiffre ticket par produit/catégorie.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:365}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"analyse_stock",description:"Stock maître actuel et consommations physiques récentes. Ne déduit pas les causes d'un écart.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:365}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"analyse_cafe",description:"Analyse déterministe café: cafés vendus et coffee beans consommés. Permet de comparer activité/consommation.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:365}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"analyse_chicha",description:"Analyse déterministe chicha: normales, personnel et tombac consommé.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:365}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"analyse_consumption",description:"Analyse les consommations physiques et corrections enregistrées; utile pour écarts de stock et articles à surveiller.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:365}},required:["days"],additionalProperties:false}}},
 {type:"function",function:{name:"compare_periods",description:"Compare deux périodes consécutives de même durée sur recettes, ticket, corrections, ventes café et chicha. La période récente est comparée à la période précédente.",parameters:{type:"object",properties:{days:{type:"integer",minimum:1,maximum:180}},required:["days"],additionalProperties:false}}}
];

export async function executeAnalyticsTool(name:string,args:any={}){
 if(name==="simulate_business_decision"){
  if(args.scenario==="price")return scenarioCalculations.price(Number(args.currentPrice),Number(args.newPrice),Number(args.units));
  if(args.scenario==="loan")return scenarioCalculations.loan(Number(args.principal),Number(args.annualRatePercent),Number(args.months));
  throw new Error("Simulation inconnue");
 }
 if(args.days!==undefined&&(!Number.isInteger(args.days)||args.days<1||args.days>365||(name==="analyze_business_question"||name==="analyze_opportunities"||name==="compare_periods")&&args.days>180))throw new Error("Période invalide");
 const s=await shop(); const days=Math.max(1,Math.min(365,Number(args.days||7))); const start=since(days);
 if(name==="analyze_financial_health"){
  const shifts=await prisma.shift.findMany({where:recorded(s.id,start),select:{id:true,recordedAt:true,ticketTotal:true,cashCaisse:true,recetteFinale:true,expenseTotal:true,staffSalary:true,acceptedCorrectionTotal:true},orderBy:{recordedAt:"desc"},take:2000});
  const field=(k:keyof typeof shifts[number])=>sumMoney(shifts.map(x=>x[k]));
  return {classification:"FACT_AND_CALCULATION",period:{days,start:start.toISOString(),end:new Date().toISOString()},shiftCount:shifts.length,truncated:shifts.length===2000,financial:{ticketSales:field("ticketTotal"),cashCaisse:field("cashCaisse"),recetteFinale:field("recetteFinale"),recordedExpenses:field("expenseTotal"),staffSalary:field("staffSalary"),acceptedCorrections:field("acceptedCorrectionTotal"),grossMargin:null,netProfit:null},missingInputs:["coûts d'achat/matières","charges fixes","charges fiscales et financières","coûts non enregistrés"],warning:"La recette finale n'est pas un bénéfice net. Les sommes de cash caisse et recette finale sont des agrégats de shifts, pas un solde bancaire."};
 }
 if(name==="analyze_opportunities"){
  const [sales,comparison,consumption]=await Promise.all([executeAnalyticsTool("analyse_sales",{days}),executeAnalyticsTool("compare_periods",{days}),executeAnalyticsTool("analyse_consumption",{days})]);
  const total=sales.ticketRevenue;
  const ranked=[...sales.lines].sort((a:any,b:any)=>b.total-a.total);
  const top=ranked.slice(0,5).map((x:any)=>({product:x.product,category:x.category,revenue:x.total,sharePercent:total>0?r3(100*x.total/total):null}));
  const byCategory=new Map<string,number>();for(const x of sales.lines)byCategory.set(x.category,(byCategory.get(x.category)||0)+x.total);
  const categories=[...byCategory].map(([category,revenue])=>({category,revenue:r3(revenue),sharePercent:total>0?r3(100*revenue/total):null})).sort((a,b)=>b.revenue-a.revenue);
  const corrections=new Map<string,{item:string,occurrences:number,absoluteAmount:number,netAmount:number}>();
  for(const x of consumption.corrections){const k=x.item;const a=corrections.get(k)||{item:k,occurrences:0,absoluteAmount:0,netAmount:0};a.occurrences++;a.absoluteAmount+=Math.abs(x.acceptedAmount);a.netAmount+=x.acceptedAmount;corrections.set(k,a)}
  const recurring=[...corrections.values()].filter(x=>x.occurrences>=2).map(x=>({...x,absoluteAmount:r3(x.absoluteAmount),netAmount:r3(x.netAmount)})).sort((a,b)=>b.absoluteAmount-a.absoluteAmount);
  const signals:any[]=[];
  if(top.length&&top[0].sharePercent>=40)signals.push({kind:"REVENUE_CONCENTRATION",classification:"CALCULATION",evidence:top[0],recommendation:"Comparer la concentration sur plusieurs périodes et tester une offre complémentaire",successMetric:"part du chiffre ticket par produit"});
  if(recurring.length)signals.push({kind:"REPEATED_STOCK_CORRECTIONS",classification:"CALCULATION",evidence:recurring.slice(0,5),recommendation:"Vérifier les fiches stock et règles de consommation",successMetric:"fréquence et montant absolu des corrections"});
  if(comparison.previous.shifts>0&&comparison.recent.shifts>0&&comparison.changes.ticketPercent!=null&&comparison.changes.ticketPercent<0)signals.push({kind:"TICKET_DECLINE",classification:"CALCULATION",evidence:comparison.changes,qualification:comparison.comparability.warning,recommendation:"Comparer les ventes par produit et le nombre de shifts avant de conclure",successMetric:"ventes ticket par shift"});
  return {classification:"FACT_AND_CALCULATION",periodDays:days,totalTicketRevenue:total,topProducts:top,categories,recurringCorrections:recurring.slice(0,10),comparison,signals,missingInputs:["coûts matière et marges","transactions individuelles/horaires pour panier moyen et heures de pointe"],warnings:["Les opportunités sont des hypothèses à tester, pas des bénéfices garantis","Les corrections ne prouvent ni vol ni gaspillage"]};
 }
 if(name==="analyze_business_question"){
  const [shifts,sales,consumption,comparison,opportunities,financialHealth]=await Promise.all([
   prisma.shift.findMany({where:{shopId:s.id,status:"RECORDED",recordedAt:{gte:start}},select:{id:true,recordedAt:true,ticketTotal:true,cashCaisse:true,recetteFinale:true,expenseTotal:true,staffSalary:true,acceptedCorrectionTotal:true},orderBy:{recordedAt:"desc"},take:500}),
   executeAnalyticsTool("analyse_sales",{days}),
   executeAnalyticsTool("analyse_consumption",{days}),
   executeAnalyticsTool("compare_periods",{days:Math.min(days,180)}),
   executeAnalyticsTool("analyze_opportunities",{days}),
   executeAnalyticsTool("analyze_financial_health",{days})
  ]);
  return {classification:"FACT_AND_CALCULATION",period:{start:start.toISOString(),end:new Date().toISOString(),days},shiftCount:shifts.length,truncated:shifts.length===500,shiftIds:shifts.map(x=>x.id),financial:financialHealth.financial,sales,consumption,comparison,opportunities,insights:{topRevenueProducts:sales.lines.slice().sort((a:any,b:any)=>b.total-a.total).slice(0,5),historicalAssessmentAvailable:shifts.length>1},missingInputs:["coûts des marchandises","loyer et charges fixes","impôts et taxes","flux de trésorerie et service de dette"],warnings:["Recette finale, caisse et ticket sont des indicateurs distincts","Aucune conclusion sur le bénéfice net ou la capacité d'emprunt sans coûts et flux financiers","Période glissante, couverture des shifts non garantie"]};
 }
 if(name==="get_last_shift"){
  const x=await prisma.shift.findFirst({where:{shopId:s.id,status:"RECORDED"},orderBy:{recordedAt:"desc"},include:{worker:true,corrections:true,metrics:true,saleLines:true,stockLines:true}});
  if(!x) return {found:false};
  const metrics=Object.fromEntries(x.metrics.map(m=>[m.metricCode,{value:n(m.value),unit:m.unit}]));
  return {found:true,id:x.id,recordedAt:(x.recordedAt||x.closedAt).toISOString(),worker:x.worker?.name||null,recetteFinale:n(x.recetteFinale),cashCaisse:n(x.cashCaisse),ticketTotal:n(x.ticketTotal),correctionsRetenues:n(x.acceptedCorrectionTotal),depenses:n(x.expenseTotal),staffSalaire:n(x.staffSalary),ramiGames:n(x.ramiGames),sales:x.saleLines.map(l=>({category:l.category,product:l.normalizedProductName||l.rawProductName,quantity:l.quantity,total:n(l.lineTotal)})),stock:x.stockLines.map(l=>({item:l.normalizedItemName||l.rawItemName,start:l.startQty,ajout:l.addedQty,fin:l.endQty,consumed:l.consumedQty,unit:l.unit})),corrections:x.corrections.map(c=>({code:c.correctionCode,expected:c.expectedQty,actual:c.actualConsumedQty,difference:c.differenceQty,amount:n(c.acceptedAmount),decision:c.decision})),metrics};
 }
 if(name==="analyse_last_shift_expert"){
  const x=await prisma.shift.findFirst({where:{shopId:s.id,status:"RECORDED"},orderBy:{recordedAt:"desc"},include:{worker:true,corrections:{include:{item:true}},metrics:true,saleLines:true,stockLines:true,expenses:true}});
  if(!x) return {found:false};
  const metric=(code:string)=>r3(x.metrics.filter(m=>m.metricCode===code).reduce((a,m)=>a+n(m.value),0));
  const coffeeSold=metric("COFFEE_SOLD"), beans=metric("COFFEE_BEANS_CONSUMED");
  const chichaNormal=metric("CHICHA_NORMAL"), chichaPersonnel=metric("CHICHA_PERSONNEL"), tombac=metric("TOMBAC_CONSUMED");
  const sales=x.saleLines.map(l=>({category:l.category,product:l.normalizedProductName||l.rawProductName,quantity:r3(l.quantity),unitPrice:l.unitPrice==null?null:n(l.unitPrice),total:l.lineTotal==null?null:r3(n(l.lineTotal))}));
  const byQuantity=[...sales].sort((a,b)=>b.quantity-a.quantity);
  const byRevenue=[...sales].filter(a=>a.total!=null).sort((a,b)=>(b.total||0)-(a.total||0));
  const corrections=x.corrections.map(c=>({item:c.item?.name||c.correctionCode,code:c.correctionCode,expected:c.expectedQty==null?null:r3(c.expectedQty),actual:c.actualConsumedQty==null?null:r3(c.actualConsumedQty),difference:c.differenceQty==null?null:r3(c.differenceQty),automaticAmount:r3(n(c.automaticAmount)),acceptedAmount:r3(n(c.acceptedAmount)),decision:c.decision})).sort((a,b)=>Math.abs(b.acceptedAmount)-Math.abs(a.acceptedAmount));
  const stock=x.stockLines.map(l=>({item:l.normalizedItemName||l.rawItemName,unit:l.unit,start:l.startQty,added:l.addedQty,end:l.endQty,consumed:l.consumedQty==null?null:r3(l.consumedQty)}));

  // V6.1: compare the latest shift with prior recorded shifts only. The backend computes
  // the reference and flags unusual ratios; OpenAI only interprets these trusted facts.
  const prior=await prisma.shift.findMany({
    where:{shopId:s.id,status:"RECORDED",id:{not:x.id}},
    orderBy:{recordedAt:"desc"},take:10,include:{metrics:true}
  });
  const priorRatio=(soldCode:string,consumedCode:string)=>{
    const ratios=prior.map(sh=>{
      const sold=sh.metrics.filter(m=>m.metricCode===soldCode).reduce((a,m)=>a+n(m.value),0);
      const consumed=sh.metrics.filter(m=>m.metricCode===consumedCode).reduce((a,m)=>a+n(m.value),0);
      return sold>0?consumed/sold:null;
    }).filter((v):v is number=>v!=null && Number.isFinite(v));
    return ratios.length?{shiftCount:ratios.length,average:r3(ratios.reduce((a,v)=>a+v,0)/ratios.length),min:r3(Math.min(...ratios)),max:r3(Math.max(...ratios))}:null;
  };
  const coffeeHistory=priorRatio("COFFEE_SOLD","COFFEE_BEANS_CONSUMED");
  const chichaHistory=(()=>{
    const ratios=prior.map(sh=>{
      const normal=sh.metrics.filter(m=>m.metricCode==="CHICHA_NORMAL").reduce((a,m)=>a+n(m.value),0);
      const personnel=sh.metrics.filter(m=>m.metricCode==="CHICHA_PERSONNEL").reduce((a,m)=>a+n(m.value),0);
      const grams=sh.metrics.filter(m=>m.metricCode==="TOMBAC_CONSUMED").reduce((a,m)=>a+n(m.value),0);
      return normal+personnel>0?grams/(normal+personnel):null;
    }).filter((v):v is number=>v!==null&&Number.isFinite(v));
    return ratios.length?{shiftCount:ratios.length,average:r3(ratios.reduce((a,v)=>a+v,0)/ratios.length),min:r3(Math.min(...ratios)),max:r3(Math.max(...ratios))}:null;
  })();
  const coffeeCurrent=coffeeSold>0?r3(beans/coffeeSold):null;
  const chichaCurrent=chichaNormal+chichaPersonnel>0?r3(tombac/(chichaNormal+chichaPersonnel)):null;
  const anomaly=(label:string,current:number|null,ref:any)=>{
    if(current==null||!ref||ref.shiftCount<2||ref.average<=0) return null;
    const multiple=r3(current/ref.average), percent=r3((current-ref.average)/ref.average*100);
    // No arbitrary business threshold: outside the actually observed prior range is factual.
    if(current>ref.max||current<ref.min) return {metric:label,current,historicalAverage:ref.average,historicalMin:ref.min,historicalMax:ref.max,comparisonMultiple:multiple,percentVsAverage:percent,reason:"hors de la plage observée des shifts précédents"};
    return null;
  };
  const anomalies=[anomaly("gramsPerCoffee",coffeeCurrent,coffeeHistory),anomaly("gramsPerMappedChicha",chichaCurrent,chichaHistory)].filter(Boolean);
  return {
    found:true, scope:"single_last_recorded_shift", shiftId:x.id, recordedAt:(x.recordedAt||x.closedAt).toISOString(), worker:x.worker?.name||null,
    finance:{recetteFinale:r3(n(x.recetteFinale)),cashCaisse:r3(n(x.cashCaisse)),ramiGames:r3(n(x.ramiGames)),ramiValue:r3(n(x.ramiValue)),ticketTotal:r3(n(x.ticketTotal)),acceptedCorrections:r3(n(x.acceptedCorrectionTotal)),expenses:r3(n(x.expenseTotal)),staffSalary:r3(n(x.staffSalary))},
    sales:{lines:sales,totalArticles:r3(sales.reduce((a,v)=>a+v.quantity,0)),ticketRevenue:r3(sales.reduce((a,v)=>a+(v.total||0),0)),topByQuantity:byQuantity.slice(0,5),topByRevenue:byRevenue.slice(0,5)},
    stock:{lines:stock,largestPhysicalConsumption:[...stock].filter(v=>v.consumed!=null).sort((a,b)=>Math.abs(b.consumed||0)-Math.abs(a.consumed||0)).slice(0,8)},
    corrections:{lines:corrections,totalAccepted:r3(corrections.reduce((a,v)=>a+v.acceptedAmount,0)),largest:corrections.slice(0,5)},
    cafe:{sold:coffeeSold,beansConsumed:beans,beansUnit:"g",gramsPerCoffee:coffeeCurrent},
    chicha:{normal:chichaNormal,personnel:chichaPersonnel,total:r3(chichaNormal+chichaPersonnel),tombacConsumed:tombac,tombacUnit:"g",gramsPerMappedChicha:chichaCurrent},
    historicalReference:{priorRecordedShifts:prior.length,coffeeGramsPerCoffee:coffeeHistory,chichaGramsPerMappedChicha:chichaHistory},
    anomalies,
    missingBusinessData:["coûts matière / coûts d'achat","marges par produit","données de fréquentation/occupation","horaires de vente détaillés si non enregistrés"],
    interpretationRules:["Les corrections ne sont pas du chiffre d'affaires ticket.","Un écart ne prouve pas sa cause: signaler ce qui mérite vérification sans accuser ni inventer.","Comparer séparément volume vendu, consommation physique, ticket et recette finale."]
  };
 }
 if(name==="analyse_stock"){
  const [items,moves]=await Promise.all([prisma.item.findMany({where:{archivedAt:null},orderBy:{name:"asc"}}),prisma.stockMovement.findMany({where:{source:"RECETTE",shift:{shopId:s.id,status:"RECORDED",recordedAt:{gte:start}}},include:{item:true},orderBy:{createdAt:"desc"}})]);
  return {periodDays:days,warning:"Le schéma Item ne possède pas de shopId : le stock maître n'est pas isolé par café. Usage mono-café uniquement.",current:items.map(i=>({item:i.name,quantity:r3(i.quantity),unit:i.unit})),physicalConsumption:moves.map(m=>({item:m.item.name,quantity:r3(Math.abs(m.quantity)),unit:m.item.unit,at:m.createdAt.toISOString()}))};
 }
 if(name==="analyse_sales"){
  const rows=await prisma.shiftSaleLine.findMany({where:{shift:{shopId:s.id,status:"RECORDED",recordedAt:{gte:start}}}}); const map=new Map<string,{product:string,category:string,quantity:number,total:number}>();
  for(const x of rows){const k=`${x.category}|${x.normalizedProductName||x.rawProductName}`; const a=map.get(k)||{product:x.normalizedProductName||x.rawProductName,category:x.category,quantity:0,total:0};a.quantity+=x.quantity;a.total+=n(x.lineTotal);map.set(k,a)}
  return {periodDays:days,lines:[...map.values()].map(x=>({...x,quantity:r3(x.quantity),total:r3(x.total)})).sort((a,b)=>b.quantity-a.quantity),totalQuantity:r3(rows.reduce((a,x)=>a+x.quantity,0)),ticketRevenue:sumMoney(rows.map(x=>x.lineTotal))};
 }
 if(name==="analyse_cafe"||name==="analyse_chicha"){
  const codes=name==="analyse_cafe"?["COFFEE_SOLD","COFFEE_BEANS_CONSUMED"]:["CHICHA_NORMAL","CHICHA_PERSONNEL","TOMBAC_CONSUMED"];
  const ms=await prisma.shiftMetric.findMany({where:{shift:{shopId:s.id,status:"RECORDED",recordedAt:{gte:start}},metricCode:{in:codes}}}); const sum=(c:string)=>r3(ms.filter(m=>m.metricCode===c).reduce((a,m)=>a+n(m.value),0));
  if(name==="analyse_cafe"){const sold=sum("COFFEE_SOLD"),beans=sum("COFFEE_BEANS_CONSUMED");return {periodDays:days,coffeeSold:sold,beansConsumed:beans,beansUnit:"g",gramsPerCoffee:sold>0?r3(beans/sold):null};}
  const normal=sum("CHICHA_NORMAL"),personnel=sum("CHICHA_PERSONNEL"),tombac=sum("TOMBAC_CONSUMED");return {periodDays:days,chichaNormal:normal,chichaPersonnel:personnel,chichaTotal:r3(normal+personnel),tombacConsumed:tombac,tombacUnit:"g",gramsPerMappedChicha:normal+personnel>0?r3(tombac/(normal+personnel)):null};
 }
 if(name==="analyse_consumption"){
  const [moves,corr]=await Promise.all([prisma.stockMovement.findMany({where:{source:"RECETTE",shift:{shopId:s.id,status:"RECORDED",recordedAt:{gte:start}}},include:{item:true}}),prisma.shiftCorrection.findMany({where:{shift:{shopId:s.id,status:"RECORDED",recordedAt:{gte:start}}},include:{item:true}})]);
  const cm=new Map<string,{item:string,quantity:number,unit:string}>(); for(const m of moves){const a=cm.get(m.itemId)||{item:m.item.name,quantity:0,unit:m.item.unit};a.quantity+=Math.abs(m.quantity);cm.set(m.itemId,a)}
  return {periodDays:days,physicalConsumption:[...cm.values()].map(x=>({...x,quantity:r3(x.quantity)})),corrections:corr.map(c=>({item:c.item?.name||c.correctionCode,expected:c.expectedQty,actual:c.actualConsumedQty,difference:c.differenceQty,acceptedAmount:n(c.acceptedAmount),decision:c.decision})),acceptedCorrectionTotal:r3(corr.reduce((a,c)=>a+n(c.acceptedAmount),0))};
 }
 if(name==="compare_periods"){
  const d=Math.min(180,days),cut=new Date(Date.now()-d*86400000),prev=new Date(Date.now()-2*d*86400000);
  const summarize=async(from:Date,to:Date)=>{const shifts=await prisma.shift.findMany({where:{shopId:s.id,status:"RECORDED",recordedAt:{gte:from,lt:to}},include:{metrics:true}});const metric=(c:string)=>r3(shifts.flatMap(x=>x.metrics).filter(m=>m.metricCode===c).reduce((a,m)=>a+n(m.value),0));return {shifts:shifts.length,recette:r3(shifts.reduce((a,x)=>a+n(x.recetteFinale),0)),ticket:r3(shifts.reduce((a,x)=>a+n(x.ticketTotal),0)),corrections:r3(shifts.reduce((a,x)=>a+n(x.acceptedCorrectionTotal),0)),coffeeSold:metric("COFFEE_SOLD"),chichaNormal:metric("CHICHA_NORMAL"),chichaPersonnel:metric("CHICHA_PERSONNEL")};};
  const recent=await summarize(cut,new Date()),previous=await summarize(prev,cut);
  return {periodDays:d,recent:{...recent,ticketPerShift:recent.shifts?r3(recent.ticket/recent.shifts):null},previous:{...previous,ticketPerShift:previous.shifts?r3(previous.ticket/previous.shifts):null},changes:{ticketAbsolute:r3(recent.ticket-previous.ticket),ticketPercent:pct(recent.ticket,previous.ticket),recetteAbsolute:r3(recent.recette-previous.recette),recettePercent:pct(recent.recette,previous.recette)},comparability:{sameCalendarDuration:true,shiftCountsEqual:recent.shifts===previous.shifts,warning:recent.shifts!==previous.shifts?"Nombre de shifts différent : comparer les moyennes par shift et vérifier les horaires.":"La couverture des horaires reste inconnue."},note:"Comparer les valeurs brutes; ne pas inventer de causalité."};
 }
 throw new Error(`Outil analytics inconnu: ${name}`);
}
