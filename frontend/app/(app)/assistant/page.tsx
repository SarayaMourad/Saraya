"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import AppFrame from "../../../components/AppFrame";
import { api, getApiError } from "../../../lib/api";
import { ArrowIcon, CloseIcon, PaperclipIcon, PlusIcon } from "../../../components/icons";
import type { ChatMessage } from "../../../lib/types";

const CHAT_STORAGE_KEY = "saraya-assistant-chat-v1";
const CHAT_TTL_MS = 30 * 60 * 1000;

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Bonjour Mourad. Envoyez-moi des photos ou posez une question."
};

const suggestions = [
  "/recette",
  "Ajouter du stock",
  "Combien de lait me reste ?",
  "Analyse de la semaine"
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [text, setText] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, previews]);

  // Keep the conversation available for 30 minutes after the last activity.
  // Image object URLs are intentionally not persisted because they are only valid
  // for the current browser session; the text conversation is restored safely.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { updatedAt?: number; messages?: ChatMessage[] };
        if (saved.updatedAt && Date.now() - saved.updatedAt <= CHAT_TTL_MS && Array.isArray(saved.messages) && saved.messages.length) {
          setMessages(saved.messages);
        } else {
          localStorage.removeItem(CHAT_STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } finally {
      setChatLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!chatLoaded) return;
    const safeMessages = messages.map(({ imageUrl, imageUrls, ...message }) => message);
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ updatedAt: Date.now(), messages: safeMessages }));
  }, [messages, chatLoaded]);

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []).filter((f) => f.type.startsWith("image/"));
    const available = Math.max(0, 2 - selectedImages.length);
    const filesToAdd = incoming.slice(0, available);
    if (filesToAdd.length) {
      setSelectedImages((current) => [...current, ...filesToAdd].slice(0, 2));
      setPreviews((current) => [...current, ...filesToAdd.map((f) => URL.createObjectURL(f))].slice(0, 2));
    }
    event.target.value = "";
  }

  function removeImage(index: number) {
    setPreviews((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target);
      return current.filter((_, i) => i !== index);
    });
    setSelectedImages((current) => current.filter((_, i) => i !== index));
  }

  function removeImages() {
    previews.forEach((url) => URL.revokeObjectURL(url));
    setSelectedImages([]);
    setPreviews([]);
  }

  async function send(customText?: string) {
    const message = customText ?? text;
    if ((!message.trim() && selectedImages.length === 0) || busy) return;

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: message || "Photos de feuille de shift",
      imageUrl: previews[0],
      imageUrls: [...previews],
      filename: selectedImages[0]?.name,
      filenames: selectedImages.map((file) => file.name)
    };

    setMessages((current) => [...current, userMessage]);
    setText("");
    setBusy(true);

    try {
      const form = new FormData();
      form.append("message", message);
      form.append("history", JSON.stringify(
        messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content }))
      ));
      selectedImages.forEach((file) => form.append("images", file));

      const response = await api.post("/chat", form);
      const data = response.data;

      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.answer,
          source: data.source,
          actionId: data.actionId,
          preview: data.preview,
          requiresConfirmation: data.requiresConfirmation,
          recetteState: data.recetteState,
          recetteData: data.recetteData,
          recetteCalculations: data.recetteCalculations,
          recetteFinal: data.recetteFinal,
          shiftId: data.shiftId
        }
      ]);

      removeImages();
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: getApiError(err, "L'assistant est momentanément indisponible.")
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  async function confirm(actionId: string) {
    try {
      setBusy(true);
      const response = await api.post("/chat/confirm", { actionId });
      setMessages((current) => [
        ...current.map((m) => m.actionId === actionId ? { ...m, requiresConfirmation: false } : m),
        {
          id: `confirm-${Date.now()}`,
          role: "assistant",
          content: response.data.answer
        }
      ]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        { id: `e-${Date.now()}`, role: "assistant", content: getApiError(err) }
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(actionId: string) {
    try {
      await api.post("/chat/cancel", { actionId });
    } finally {
      setMessages((current) => current.map((m) => m.actionId === actionId ? { ...m, requiresConfirmation: false } : m));
    }
  }

  return (
    <AppFrame>
      <header className="assistant-header sticky top-0 z-10 border-b border-saraya-border/80 bg-white/85 px-5 py-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-medium text-saraya-text">Assistant Saraya</span>
          <span className="flex items-center gap-2 text-[13px] text-saraya-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-saraya-primary" />
            En ligne
          </span>
        </div>
      </header>

      <div ref={scrollRef} className="h-[calc(100dvh-145px)] overflow-y-auto px-5 pb-32 pt-6">
        {messages.map((message) => (
          <div key={message.id} className={`mb-5 ${message.role === "user" ? "flex justify-end" : ""}`}>
            <div className={message.role === "user" ? "max-w-[80%]" : "max-w-[88%]"}>
              {(message.imageUrls?.length ? message.imageUrls : message.imageUrl ? [message.imageUrl] : []).length > 0 && (
                <div className="mb-2 flex max-w-[220px] gap-2">
                  {(message.imageUrls?.length ? message.imageUrls : [message.imageUrl!]).map((src, index) => (
                    <div key={`${message.id}-img-${index}`} className="min-w-0">
                      <img src={src} alt="" className="h-24 w-24 rounded-xl object-cover" />
                      <div className="mt-1 truncate text-[11px] text-saraya-secondary">
                        {message.filenames?.[index] || (index === 0 ? message.filename : `Photo ${index + 1}`)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {message.role === "assistant" && message.recetteState ? (
                <RecetteMessage message={message} onCommand={send} busy={busy} />
              ) : (
                <div className={message.role === "user"
                  ? "message-user"
                  : "message-assistant"}
                >
                  <ReadableText text={message.content} />
                </div>
              )}

              {message.source && (
                <div className="mt-1 text-[12px] italic text-saraya-secondary">Source : {message.source}</div>
              )}

              {message.requiresConfirmation && message.actionId && (
                <div className="mt-3">
                  {message.preview && <div className="mb-2 text-[13px] text-saraya-secondary">{message.preview}</div>}
                  <div className="flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => confirm(message.actionId!)}
                      className="rounded-[10px] bg-saraya-primary px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                    >
                      Confirmer
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => cancel(message.actionId!)}
                      className="rounded-[10px] border border-saraya-border bg-white px-5 py-2.5 text-[13px] text-saraya-text"
                    >
                      Modifier
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-[13px] text-saraya-secondary">Traitement…</div>}
      </div>

      <div className="composer chat-composer fixed bottom-0 z-20 w-full px-4 pb-[76px] pt-3">
        {previews.length > 0 && (
          <div className="mb-2 flex gap-2">
            {previews.map((src, index) => (
              <div key={src} className="relative">
                <img src={src} alt="" className="h-16 w-16 rounded-xl object-cover" />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-white text-saraya-text"
                  aria-label={`Retirer la photo ${index + 1}`}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={selectedImages.length >= 2}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-saraya-border bg-white text-saraya-text disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={selectedImages.length >= 2 ? "Maximum 2 photos" : "Ajouter une photo"}
          >
            <PlusIcon />
          </button>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={addFiles} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Écrivez ou envoyez une photo…"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-saraya-border bg-white px-4 text-[15px] shadow-sm"
          />
          <button
            disabled={busy || (!text.trim() && selectedImages.length === 0)}
            onClick={() => send()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-saraya-primary text-white disabled:opacity-50"
            aria-label="Envoyer"
          >
            <ArrowIcon />
          </button>
        </div>
      </div>
    </AppFrame>
  );
}


function ReadableText({ text }: { text: string }) {
  // Defensive cleanup for model/provider rendering artifacts (e.g. a dangling "svg" token).
  const clean = text
    .replace(/\\<|\\>/g, "")
    .replace(/^\s*svg\s*$/gim, "")
    .replace(/<\/?svg\b[^>]*>/gi, "")
    .trim();
  const parts = clean.split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-ÝÉÈÊÇ])/).map(x => x.trim()).filter(Boolean);
  return <div className="readable-text">{parts.map((part, i) => <p key={i}>{part}</p>)}</div>;
}

function Money({ value, sign = false }: { value: number | null | undefined; sign?: boolean }) {
  if (value == null) return <>—</>;
  const prefix = sign && value > 0 ? "+" : "";
  return <>{prefix}{new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value)} DT</>;
}

function RecetteMessage({ message, onCommand, busy }: { message: ChatMessage; onCommand: (text: string) => void; busy: boolean }) {
  const d = message.recetteData;
  const c = message.recetteCalculations;
  const f = message.recetteFinal;
  const state = message.recetteState;
  const [customAmounts,setCustomAmounts]=useState<Record<string,string>>({});
  const [accepted,setAccepted]=useState<Record<string,boolean>>({});
  // Local-only owner edits. Nothing is sent until the single confirmation click.
  const [draft,setDraft]=useState<any>(()=>({
    worker: d?.stock?.worker ?? "",
    cash: "", // Must be manually entered, never extracted/pre-filled.
    depense: numberInput(d?.stock?.depense),
    staffSalaire: numberInput(d?.stock?.staffSalaire),
    ramiGames: numberInput(d?.stock?.ramiGames),
    stock: (d?.stock?.lines || []).map((x:any)=>({start:numberInput(x.start),ajout:numberInput(x.ajout),fin:numberInput(x.fin)})),
    ticket: (d?.ticket?.lines || []).map((x:any)=>({category:x.category??"",qte:numberInput(x.qte),unitPrice:numberInput(x.unitPrice),total:numberInput(x.total),ratio:numberInput(x.ratio)})),
    ticketTotal:numberInput(d?.ticket?.ticketTotal)
  }));
  const changeStock=(i:number,key:string,value:string)=>setDraft((old:any)=>({...old,stock:old.stock.map((x:any,j:number)=>j===i?{...x,[key]:value}:x)}));
  const changeTicket=(i:number,key:string,value:string)=>setDraft((old:any)=>({...old,ticket:old.ticket.map((x:any,j:number)=>j===i?{...x,[key]:value}:x)}));
  const numberOrNull=(v:string):number|null=>v.trim()===""?null:Number(v.replace(",","."));
  const validNumber=(v:string,required=false)=>!required&&v.trim()==="" || /^\d+(?:[.,]\d{1,3})?$/.test(v.trim());
  const validData=validNumber(draft.cash,true) && validNumber(draft.depense,true) && validNumber(draft.staffSalaire,true) && validNumber(draft.ramiGames,true) && validNumber(draft.ticketTotal,true) &&
    draft.stock.every((x:any)=>[x.start,x.ajout,x.fin].every((v:string)=>validNumber(v,true)) && Number(x.start.replace(",","."))+Number(x.ajout.replace(",","."))>=Number(x.fin.replace(",","."))) &&
    draft.ticket.every((x:any)=>[x.qte,x.unitPrice,x.total].every((v:string)=>validNumber(v,true)) && validNumber(x.ratio));
  const sendDraft=()=>{
    if(!validData)return;
    const payload={
      stock:{worker:draft.worker.trim()||null,cashCaisse:numberOrNull(draft.cash),depense:numberOrNull(draft.depense),staffSalaire:numberOrNull(draft.staffSalaire),ramiGames:numberOrNull(draft.ramiGames),
        lines:d.stock.lines.map((x:any,i:number)=>({item:x.item,start:numberOrNull(draft.stock[i].start),ajout:numberOrNull(draft.stock[i].ajout),fin:numberOrNull(draft.stock[i].fin)}))},
      ticket:{ticketTotal:numberOrNull(draft.ticketTotal),lines:d.ticket.lines.map((x:any,i:number)=>({product:x.product,category:draft.ticket[i].category.trim()||null,qte:numberOrNull(draft.ticket[i].qte),unitPrice:numberOrNull(draft.ticket[i].unitPrice),total:numberOrNull(draft.ticket[i].total),ratio:numberOrNull(draft.ticket[i].ratio)}))}
    };
    onCommand("CONFIRME DONNÉES | DRAFT="+JSON.stringify(payload));
  };
  const field=(label:string,value:string,onChange:(v:string)=>void,required=false)=>
    <label style={{display:"flex",flexDirection:"column",gap:5,fontSize:12,minWidth:95}}><span>{label}{required?" *":""}</span><input inputMode="decimal" aria-label={label} value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",minWidth:85,border:"1px solid #d5ddd8",borderRadius:8,padding:"10px 8px",background:"white"}} /></label>;
  const decisions = (c?.corrections || []).map((x:any) => { const yes = accepted[x.code] ?? (x.decision === "ACCEPTED" || x.decision === "MODIFIED"); const raw = customAmounts[x.code] ?? Number(x.automaticAmount).toFixed(3); const mills = parseDraftMillimes(raw); return {code:x.code, accepted:yes, amountMillimes:yes ? mills : 0}; });
  const totalMills = decisions.reduce((sum:number,x:any)=>sum+(x.amountMillimes ?? 0),0);
  const validCorrections = decisions.every((x:any)=>x.amountMillimes !== null);
  const steps = ["Documents", "Vérification", "Corrections", "Recette", "Enregistré"];
  const active = state === "REVIEW_DATA" ? 1 : state === "REVIEW_CORRECTIONS" ? 2 : state === "READY_TO_RECORD" ? 3 : 4;
  return <div className="recette-card">
    <div className="recette-head"><div><span className="eyebrow">/recette</span><h3>{state === "RECORDED" ? "Shift enregistré" : state === "READY_TO_RECORD" ? "Recette prête" : state === "REVIEW_CORRECTIONS" ? "Corrections" : "Vérification des données"}</h3></div><span className={`status-pill ${state === "RECORDED" ? "done" : ""}`}>{state === "RECORDED" ? "Terminé" : "À vérifier"}</span></div>
    <div className="stepper">{steps.map((x,i)=><div key={x} className={`step ${i<=active?"active":""}`}><span>{i<active?"✓":i+1}</span><small>{x}</small></div>)}</div>
    {state === "REVIEW_DATA" && d && <>
      <div style={{padding:"16px 20px"}}><p style={{marginBottom:12}}>Corrigez directement toutes les valeurs extraites. Un seul envoi lors de la confirmation.</p>
        <label style={{display:"block",marginBottom:12}}>Employé (Worker)<input value={draft.worker} onChange={e=>setDraft((v:any)=>({...v,worker:e.target.value}))} style={{display:"block",border:"1px solid #d5ddd8",borderRadius:8,padding:10,marginTop:5,width:"100%"}}/></label>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
          {field("Cash caisse (DT)",draft.cash,v=>setDraft((x:any)=>({...x,cash:v})),true)}
          {field("Dépenses (DT)",draft.depense,v=>setDraft((x:any)=>({...x,depense:v})),true)}
          {field("Salaire staff (DT)",draft.staffSalaire,v=>setDraft((x:any)=>({...x,staffSalaire:v})),true)}
          {field("Rami Games",draft.ramiGames,v=>setDraft((x:any)=>({...x,ramiGames:v})),true)}
        </div><small>Cash caisse obligatoire : saisissez le montant réel vous-même. La valeur extraite n'est pas préremplie.</small>
      </div>
      <SectionTitle title="Stock" subtitle={`${d.stock?.lines?.length || 0} articles détectés · toutes les quantités sont modifiables`} />
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Article</th><th>Début</th><th>Ajout</th><th>Fin</th></tr></thead><tbody>{d.stock?.lines?.map((x:any,i:number)=><tr key={`${x.item}-${i}`}><td><b>{x.item}</b><small>{x.unit||""}</small></td>{(["start","ajout","fin"] as const).map(k=><td key={k}><input aria-label={`${x.item} ${k}`} inputMode="decimal" value={draft.stock[i]?.[k]??""} onChange={e=>changeStock(i,k,e.target.value)} style={{width:"100%",minWidth:75,padding:9,border:"1px solid #d5ddd8",borderRadius:8}}/></td>)}</tr>)}</tbody></table></div>
      <SectionTitle title="Ticket caisse" subtitle={`${d.ticket?.lines?.length || 0} lignes · quantités, prix et totaux modifiables`} />
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Article / catégorie</th><th>Qté</th><th>Prix (DT)</th><th>Total (DT)</th><th>Ratio (%)</th></tr></thead><tbody>{d.ticket?.lines?.map((x:any,i:number)=><tr key={`${x.product}-${i}`}><td><b>{x.product}</b><input aria-label={`Catégorie ${x.product}`} value={draft.ticket[i]?.category??""} onChange={e=>changeTicket(i,"category",e.target.value)} style={{width:"100%",minWidth:100,border:"1px solid #d5ddd8",borderRadius:7,padding:7}}/></td>{(["qte","unitPrice","total","ratio"] as const).map(k=><td key={k}><input aria-label={`${x.product} ${k}`} inputMode="decimal" value={draft.ticket[i]?.[k]??""} onChange={e=>changeTicket(i,k,e.target.value)} style={{width:"100%",minWidth:75,padding:9,border:"1px solid #d5ddd8",borderRadius:8}}/></td>)}</tr>)}</tbody></table></div>
      <div style={{padding:"14px 20px"}}>{field("Total ticket ventes (DT)",draft.ticketTotal,v=>setDraft((x:any)=>({...x,ticketTotal:v})),true)}<small>Vérifiez que le total correspond au ticket. Il est distinct du cash caisse.</small></div>
      {!validData && <div style={{padding:"8px 20px",color:"#a94442"}}>Renseignez tous les champs obligatoires avec des nombres valides. La consommation du stock ne peut pas être négative.</div>}
    </>}
    {state === "REVIEW_CORRECTIONS" && c && <>
      <div style={{padding:"12px 20px"}}>Comparez les ventes du ticket avec la consommation du stock. Choisissez les corrections à retenir et modifiez leur montant si nécessaire.</div>
      <div style={{padding:"8px 20px"}}>{c.corrections?.map((x:any)=>{const yes=accepted[x.code] ?? (x.decision==="ACCEPTED"||x.decision==="MODIFIED");return <div key={x.code} style={{borderBottom:"1px solid #e6ebe7",padding:"18px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><b>{x.label}</b><label><input type="checkbox" checked={yes} onChange={e=>setAccepted(v=>({...v,[x.code]:e.target.checked}))}/> Accepter</label></div>
        <div className="metric-grid" style={{marginTop:12}}><Metric label="Ticket caisse" value={`${x.expected} ${x.code==="CITRON"?"L":"pcs"}`}/><Metric label="Stock consommé" value={`${x.actual} ${x.code==="CITRON"?"L":"pcs"}`}/><Metric label="Écart" value={String(x.difference)}/><Metric label="Correction proposée" value={<Money value={x.automaticAmount} sign/>}/></div>
        <label style={{display:"block",marginTop:12}}>Montant retenu (DT)</label><input aria-label={`Montant retenu pour ${x.label}`} inputMode="decimal" disabled={!yes} value={customAmounts[x.code] ?? Number(x.automaticAmount).toFixed(3)} onChange={e=>setCustomAmounts(v=>({...v,[x.code]:e.target.value}))} style={{width:160,border:"1px solid #d5ddd8",borderRadius:8,padding:9,marginTop:6}}/>
      </div>})}</div>
      <div className="hero-total"><span>Total corrections retenues</span><strong>{validCorrections?<Money value={totalMills/1000} sign/>:"Montant invalide"}</strong></div>
      <div className="insight-grid"><Metric label="Cafés servis" value={String(c.coffee?.soldCoffees ?? "—")} sub={c.coffee?.beansConsumed != null ? `${c.coffee.beansConsumed} g de grains` : undefined}/><Metric label="Chichas servies" value={String(c.chicha?.total ?? "—")} sub={c.chicha?.tombacConsumed != null ? `${c.chicha.tombacConsumed} g de tombac` : undefined}/></div>
    </>}
    {(state === "READY_TO_RECORD" || state === "RECORDED") && f && <>
      <div className="final-total"><span>Recette finale</span><strong><Money value={f.recetteFinale}/></strong></div>
      <div className="ledger"><Ledger label="Cash caisse" value={f.cashCaisse}/><Ledger label={`Rami Games (${f.ramiGames} × ${f.ramiMultiplier?.toFixed?.(3) || f.ramiMultiplier} DT)`} value={f.ramiValue} sign/><Ledger label="Corrections" value={f.acceptedCorrectionTotal} sign/><Ledger label="Dépenses" value={-f.depense} sign/><Ledger label="Salaire" value={-f.staffSalaire} sign/><Ledger label="Ticket caisse" value={f.ticketTotal} muted/></div>
      {state === "RECORDED" && <div className="success-panel"><b>Tout est enregistré.</b><span>Stock, ventes, corrections et audit ont été sauvegardés dans PostgreSQL.</span>{message.shiftId && <small>Référence · {message.shiftId}</small>}</div>}
    </>}
    {!state?.startsWith("REVIEW") && <div className="recette-note"><ReadableText text={message.content}/></div>}
    {state !== "RECORDED" && <div className="recette-actions">
      {state === "REVIEW_DATA" && <button disabled={busy || !validData} onClick={sendDraft} className="premium-button primary">Confirmer toutes les données</button>}
      {state === "REVIEW_CORRECTIONS" && <button disabled={busy || !validCorrections} onClick={() => onCommand("CONFIRME CORRECTIONS | DRAFT=" + JSON.stringify(decisions))} className="premium-button primary">Confirmer les corrections</button>}
      {state === "READY_TO_RECORD" && <button disabled={busy} onClick={() => onCommand("OUI ENREGISTRE")} className="premium-button primary">Enregistrer le shift</button>}
    </div>}
  </div>;
}
function numberInput(v:number|null|undefined):string { return v==null?"":String(v); }
function parseDraftMillimes(value:string):number|null { const m=value.trim().replace(/\s*DT$/i,"").replace(/\s/g,"").match(/^(-?)(\d+)(?:[.,](\d{1,3}))?$/);if(!m)return null;const n=Number(m[2])*1000+Number((m[3]||"").padEnd(3,"0"));return Number.isSafeInteger(n)?(m[1]? -n:n):null; }
function Metric({label,value,sub}:{label:string;value:React.ReactNode;sub?:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}
function SectionTitle({title,subtitle}:{title:string;subtitle?:string}){return <div className="section-title"><h4>{title}</h4>{subtitle&&<span>{subtitle}</span>}</div>}
function Ledger({label,value,sign,muted}:{label:string;value:number;sign?:boolean;muted?:boolean}){return <div className={`ledger-row ${muted?"muted":""}`}><span>{label}</span><b><Money value={value} sign={sign}/></b></div>}
function decisionLabel(x:string){return x==="ACCEPTED"?"Acceptée":x==="REJECTED"?"Rejetée":x==="MODIFIED"?"Modifiée":"En attente"}
