import { Router } from "express";

import multer from "multer";

import { z } from "zod";

import { prisma } from "../lib/prisma";

import { getOpenAI, friendlyOpenAIError } from "../lib/openai";

import { runTextChat } from "../lib/chat";

import { ChatAction } from "../types";

import { executeAction } from "../lib/actions";

import { createHash } from "crypto";



const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 2, fileSize: 8 * 1024 * 1024 } });



const pendingActions = new Map<string, { userId: string; action: ChatAction; expiresAt: number }>();



type RecetteData = {

  stock: {

    worker: string | null;

    lines: Array<{ item: string; start: number | null; ajout: number | null; fin: number | null; unit: string | null; confidence: number | null }>;

    cashCaisse: number | null;

    depense: number | null;

    staffSalaire: number | null;

    ramiGames: number | null;

  };

  ticket: {

    lines: Array<{ category: string | null; product: string; qte: number | null; ratio: number | null; unitPrice: number | null; total: number | null; confidence: number | null }>;

    ticketTotal: number | null;

  };

  notes: string[];

};



type RecetteSession = {

  userId: string;

  state: "REVIEW_DATA" | "REVIEW_CORRECTIONS" | "READY_TO_RECORD" | "RECORDED";

  final?: RecetteFinal;

  recordedShiftId?: string;

  calculations?: RecetteCalculations;

  data: RecetteData;

  originalData: RecetteData;

  model: string;
  sourcePhotoHash?: string;

  createdAt: number;

  updatedAt: number;

};







type CorrectionDecision = "PENDING" | "ACCEPTED" | "REJECTED" | "MODIFIED";

type RecetteCorrection = {

  code: string; label: string; actual: number; expected: number; difference: number;

  price: number; priceLabel: string; automaticAmount: number; acceptedAmount: number; decision: CorrectionDecision; note: string;

};

type RecetteFinal = {

  cashCaisse: number; ramiGames: number; ramiMultiplier: number; ramiValue: number;

  depense: number; staffSalaire: number; automaticCorrectionTotal: number; acceptedCorrectionTotal: number;

  recetteBeforeCorrection: number; recetteFinale: number; ticketTotal: number;

};



type RecetteCalculations = {

  corrections: RecetteCorrection[];

  automaticCorrectionTotal: number;

  acceptedCorrectionTotal: number;

  coffee: { soldCoffees: number; beansConsumed: number | null; coffeesPerBeanUnit: number | null };

  chicha: { total: number; personnel: number; normal: number; tombacConsumed: number | null; tombacPerNormalChicha: number | null };

};



const MOCK_RECETTE: RecetteData = {

  stock: {

    worker: "MOCK - Rami",

    lines: [

      { item: "EAU 1.5L", start: 24, ajout: 12, fin: 29, unit: "pcs", confidence: 1 },

      { item: "EAU 0.5L", start: 40, ajout: 24, fin: 48, unit: "pcs", confidence: 1 },

      { item: "GAZEUSE", start: 30, ajout: 0, fin: 25, unit: "pcs", confidence: 1 },

      { item: "CANNETTE", start: 24, ajout: 12, fin: 29, unit: "pcs", confidence: 1 },

      { item: "EAU 1L", start: 12, ajout: 0, fin: 10, unit: "pcs", confidence: 1 },

      { item: "CITRON", start: 5, ajout: 0, fin: 3.8, unit: "L", confidence: 1 },

      { item: "COFFEE BEANS", start: 3, ajout: 0, fin: 2.5, unit: "kg", confidence: 1 },

      { item: "TOMBAC", start: 1000, ajout: 0, fin: 850, unit: "g", confidence: 1 }

    ],

    cashCaisse: 186, depense: 12, staffSalaire: 20, ramiGames: 4

  },

  ticket: {

    lines: [

      { category: "BOISSON", product: "EAU 1.5L", qte: 6, ratio: null, unitPrice: 1.5, total: 9, confidence: 1 },

      { category: "BOISSON", product: "EAU 0.5L", qte: 12, ratio: null, unitPrice: 0.8, total: 9.6, confidence: 1 },

      { category: "CAFE", product: "KAMIA", qte: 2, ratio: null, unitPrice: 0, total: 0, confidence: 1 },

      { category: "BOISSON", product: "BOISSON GAZEUZE", qte: 5, ratio: null, unitPrice: 1.5, total: 7.5, confidence: 1 },

      { category: "BOISSON", product: "CANETTE", qte: 5, ratio: null, unitPrice: 2, total: 10, confidence: 1 },

      { category: "JUS", product: "CITRON", qte: 5, ratio: null, unitPrice: 2.5, total: 12.5, confidence: 1 },

      { category: "CAFE", product: "EXPRESS", qte: 14, ratio: null, unitPrice: 1.5, total: 21, confidence: 1 },

      { category: "CAFE", product: "CAPUCIN", qte: 6, ratio: null, unitPrice: 2, total: 12, confidence: 1 },

      { category: "CHICHA", product: "MENTHE", qte: 8, ratio: null, unitPrice: 5, total: 40, confidence: 1 },

      { category: "CHICHA", product: "POMME", qte: 3, ratio: null, unitPrice: 5, total: 15, confidence: 1 },

      { category: "CHICHA", product: "CHICHA PERSONEL", qte: 1, ratio: null, unitPrice: 0, total: 0, confidence: 1 }

    ], ticketTotal: 136.6

  },

  notes: ["MODE MOCK : aucune photo ni API OpenAI utilisée."]

};



// /recette state is temporary until the exact final command OUI ENREGISTRE. Phase 3 persists atomically.

const recetteSessions = new Map<string, RecetteSession>();

const RECETTE_TTL = 60 * 60 * 1000;



const RECETTE_VISION_PROMPT = `Tu extrais les données de DEUX documents réels de clôture du café Saraya. Les deux images peuvent arriver dans n'importe quel ordre.



DOCUMENT STOCK :

\- Titre possible : "SARAYA SHIFT STOCK".

\- Colonnes : ARTICLE, START, AJOUT, FIN.

\- Lignes possibles : EAU 1.5L, EAU 0.5L, GAZEUSE, Cannette, EAU 1L, EAU BOLAR, Citron, Coffee beans, Tombac.

\- À droite peuvent apparaître : Cash caisse, Depense, Staff Salaire, Rami Game.

\- WORKER peut être absent.

\- Les unités peuvent apparaître dans le nom de l’article (ex. "TOMBAC (g)") ou dans une cellule (ex. "800 g"). Retourne le nom sans suffixe d’unité et l’unité explicite dans unit. Si aucune unité visible, unit doit être null. Ne devine jamais une unité.



DOCUMENT TICKET POS :

\- Colonnes réelles possibles : Libellé, Qte, Ratio(%), Total. Il peut NE PAS y avoir de colonne Prix.

\- Ratio(%) est un pourcentage : NE LE CONFONDS JAMAIS avec le prix.

\- Les titres BOISSON, CHICHA, CAFE, JUS, etc. sont des catégories, pas des ventes.

\- Les sous-totaux de catégorie (ex. 27,800 / 44,000 / 26,200) ne sont PAS des produits.

\- "TOTAL ARTICLES" est ticketTotal.

\- Pour chaque vraie ligne produit, extrais category, product, qte, ratio et total.

\- Si qte et total sont lisibles mais aucun prix unitaire n'est imprimé, mets unitPrice à null : le backend le calculera ensuite.



RÈGLES :

\- N'invente JAMAIS une valeur. Valeur absente/illisible = null.

\- Les virgules décimales françaises doivent devenir des nombres JSON (ex. 98,000 => 98 ; 2,88 => 2.88).

\- Conserve les lignes visibles.

\- confidence doit être un nombre 0..1 ou null.

\- Ajoute une note courte pour toute ambiguïté.

\- Retourne UNIQUEMENT du JSON, sans markdown.



Structure exacte :

{

  "stock": {

    "worker": null,

    "lines": [{"item":"EAU 1.5L","start":null,"ajout":null,"fin":null,"unit":null,"confidence":null}],

    "cashCaisse": null,

    "depense": null,

    "staffSalaire": null,

    "ramiGames": null

  },

  "ticket": {

    "lines": [{"category":null,"product":"MENTHE","qte":null,"ratio":null,"unitPrice":null,"total":null,"confidence":null}],

    "ticketTotal": null

  },

  "notes": []

}`;



const RECETTE_EDIT_PROMPT = `Tu modifies uniquement des données déjà extraites pour une clôture /recette Saraya.

Le propriétaire va donner une correction en langage naturel. Applique UNIQUEMENT ce qu'il demande au JSON existant.

Ne calcule aucune correction financière, ne déduis aucun stock et n'ajoute aucune valeur non demandée.

Conserve toutes les autres valeurs exactement telles quelles.

Retourne UNIQUEMENT le JSON complet corrigé, avec exactement la même structure.`;



async function presentRecetteWithAI(client:any, stage:string, payload:any, fallback:string) {

  // Presentation is optional. The deterministic /recette workflow must NEVER

  // depend on OpenAI after the two source photos have been extracted.

  if (!client) return fallback;

  try {

    const response=await client.chat.completions.create({

      model:process.env.OPENAI_MODEL||"gpt-4.1-mini",

      messages:[

        {role:"system",content:`Vous présentez au propriétaire du café Saraya un résultat /recette DÉJÀ calculé par le backend. Vous ne recalculez rien, ne modifiez aucun nombre et n'inventez aucune cause. Français simple, lisible, maximum 10 lignes. Commencez par l'information utile, regroupez les détails techniques. Si des écarts existent, dites seulement qu'ils existent. Terminez par la commande exacte attendue. Le propriétaire peut écrire "MONTRE MOI LE DETAIL" pour voir le calcul backend complet.`},

        {role:"user",content:`Étape: ${stage}\nDonnées backend vérifiées:\n${JSON.stringify(payload)}`}

      ],temperature:0.1

    });

    return response.choices[0]?.message?.content?.trim()||fallback;

  } catch(e){ console.warn("RECETTE PRESENTATION AI FALLBACK",e instanceof Error?e.message:e); return fallback; }

}



router.post("/", upload.array("images", 2), async (req, res) => {

  try {

    const userId = (req as import("../types").AuthenticatedRequest).auth!.userId;

    cleanupRecetteSessions();



    const body = z.object({

      message: z.string().max(50000).optional().default(""),

      history: z.string().optional()

    }).parse(req.body);



    const images = (req.files as Express.Multer.File[] | undefined) || [];

    const text = body.message.trim();

    const isMockRecette = /^\/?recette(?:\s+mock|_mock)$/i.test(text);

    const isRecette = /^\/?recette\b/i.test(text) || /^\/?recette_mock$/i.test(text);

    const session = recetteSessions.get(userId);



    // OpenAI is created lazily: mock /recette and deterministic Phase 2 work without API billing.

    const getClient = async () => {

      const shop = await prisma.shop.findFirst();

      return getOpenAI(process.env.OPENAI_API_KEY?.trim() || (shop?.openaiKey?.startsWith("sk-") ? shop.openaiKey : undefined));

    };



    // Start/restart Phase 1 /recette extraction.

    if (isRecette) {

      if (isMockRecette) {

        const data = structuredClone(MOCK_RECETTE);
        await synchronizeRecetteUnits(data);

        recetteSessions.set(userId, { userId, state: "REVIEW_DATA", data, originalData: structuredClone(data), model: "mock", createdAt: Date.now(), updatedAt: Date.now() });

        return res.json({ answer: `🧪 MODE MOCK /recette — Phase 3/4 local, aucune API OpenAI utilisée.\n\n${formatRecetteReview(data, false)}`, recetteState: "REVIEW_DATA", recetteData: data, requiresConfirmation: false, action: null, preview: null, source: "mock /recette local" });

      }

      if (images.length !== 2) {

        return res.status(400).json({

          error: "Pour /recette, envoyez exactement 2 photos : la feuille SARAYA SHIFT STOCK et le ticket caisse."

        });

      }
      const sourcePhotoHash = createHash("sha256").update(images.map(file => createHash("sha256").update(file.buffer).digest("hex")).sort().join("|")).digest("hex");




      const client = await getClient();

      const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

      const content: any[] = [{ type: "text", text: RECETTE_VISION_PROMPT }];

      for (const image of images) {

        const mime = image.mimetype.startsWith("image/") ? image.mimetype : "image/jpeg";

        content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${image.buffer.toString("base64")}` } });

      }



      const completion = await client.chat.completions.create({

        model,

        messages: [{ role: "user", content }],

        temperature: 0,

        response_format: { type: "json_object" }

      });



      const data = parseAndValidateRecette(completion.choices[0]?.message?.content || "");
        await synchronizeRecetteUnits(data);

      recetteSessions.set(userId, {

        userId,

        state: "REVIEW_DATA",

        data,

        originalData: structuredClone(data),

        sourcePhotoHash,
        model,

        createdAt: Date.now(),

        updatedAt: Date.now()

      });



      const reviewAnswer="تم تحليل الوثيقتين. يرجى مراجعة البيانات قبل التأكيد.";

      return res.json({

        answer: reviewAnswer,

        recetteState: "REVIEW_DATA",

        recetteData: data,

        requiresConfirmation: false,

        action: null,

        preview: null,

        source: "2 photos /recette analysées"

      });

    }



    // Phase 4 — explicit analytics commands must never be swallowed by a completed /recette session.

    // Keep this BEFORE all recette session-state handling.

    if (/^\/?(?:analyse|analytics)\b/i.test(text)) {

      const answer = await runAnalyticsCommand(text);

      return res.json({ answer, requiresConfirmation: false, action: null, preview: null, source: "PostgreSQL analytics Saraya" });

    }



    // A /recette is being reviewed: confirmation and owner edits take priority over normal chat.

    if (session && /^(?:MONTRE|AFFICHE)(?: MOI)? (?:LE )?D[ÉE]TAILS?$/i.test(text.trim())) {

      if(session.state==="REVIEW_DATA") return res.json({answer:formatRecetteReview(session.data,false),recetteState:session.state,requiresConfirmation:false,action:null,preview:null});

      if(session.state==="REVIEW_CORRECTIONS") return res.json({answer:formatCorrectionReview(session.calculations!),recetteState:session.state,requiresConfirmation:false,action:null,preview:null});

      if((session.state==="READY_TO_RECORD"||session.state==="RECORDED")&&session.final) return res.json({answer:formatFinalRecette(session.final),recetteState:session.state,requiresConfirmation:false,action:null,preview:null});

    }

    if (session?.state === "REVIEW_DATA") {

      if (normalizeCommand(text.split(" | ")[0]) === "CONFIRME DONNEES") {
        // All owner edits are submitted together. No additional OpenAI call.
        const marker = " | DRAFT=";
        if (!text.includes(marker)) {
          return res.status(400).json({error:"RECETTE_يجب مراجعة جميع البيانات وإدخال مبلغ الصندوق يدوياً في الاستمارة."});
        }
        const rawDraft = text.slice(text.indexOf(marker) + marker.length);
        const draft = recetteDraftSchema.parse(JSON.parse(rawDraft));
        const updated = applyOwnerRecetteDraft(session.data, draft);
        await synchronizeRecetteUnits(updated);
        session.data = updated;

        session.state = "REVIEW_CORRECTIONS";

        session.calculations = calculateRecette(session.data);

        session.updatedAt = Date.now();

        const fallback="تم تأكيد البيانات. اختر التصحيحات التي تريد اعتمادها.";

        const answer=fallback;

        return res.json({

          answer,

          recetteState: "REVIEW_CORRECTIONS",

          recetteData: session.data,

          recetteCalculations: session.calculations,

          requiresConfirmation: false,

          action: null,

          preview: null

        });

      }



      if (!text) {

        return res.json({

          answer: "La /recette attend votre vérification. Écrivez une correction (ex. « EAU 0.5L FIN = 12 ») ou envoyez exactement « CONFIRME DONNÉES ».",

          recetteState: "REVIEW_DATA",

          recetteData: session.data,

          requiresConfirmation: false,

          action: null,

          preview: null

        });

      }



      const moneyEdit=text.match(/^\s*(?:cash\s*caisse|caisse|d[ée]penses?|staff\s*salaire|salaire)\s*=\s*(.+?)\s*$/i);

      if(moneyEdit){

        const mills=parseMillimes(moneyEdit[1]);

        if(mills===null || mills<0) return res.status(400).json({error:"Montant invalide. Exemple : CAISSE = 535,600"});

        const label=moneyEdit[0].split("=")[0].trim().toLowerCase();

        const key=label.includes("caisse") ? "cashCaisse" : label.includes("salaire") ? "staffSalaire" : "depense";

        session.data.stock[key]=mills/1000;

        session.updatedAt=Date.now();

        return res.json({answer:"Montant corrigé. Vérifiez le récapitulatif.",recetteState:"REVIEW_DATA",recetteData:session.data,requiresConfirmation:false,action:null,preview:null});

      }

      const edited = session.model === "mock"

        ? applyMockRecetteEdit(session.data, text)

        : await applyRecetteEdit(await getClient(), session.model, session.data, text);

      await synchronizeRecetteUnits(edited);
        session.data = edited;

      session.updatedAt = Date.now();

      return res.json({

        answer: "Modification appliquée. Vérifiez les données mises à jour ci-dessous.",

        recetteState: "REVIEW_DATA",

        recetteData: edited,

        requiresConfirmation: false,

        action: null,

        preview: null,

        source: "Données /recette corrigées par le propriétaire"

      });

    }



    if (session?.state === "REVIEW_CORRECTIONS") {

      const cmd = normalizeCommand(text);

      if (cmd.startsWith("CONFIRME CORRECTIONS | DRAFT=")) {

        const payload=text.slice(text.indexOf(" | DRAFT=")+9);

        const schema=z.array(z.object({code:z.string(),accepted:z.boolean(),amountMillimes:z.number().int().safe().nullable()}));

        const drafts=schema.parse(JSON.parse(payload));

        const current=session.calculations!;

        if(drafts.length!==current.corrections.length || new Set(drafts.map(x=>x.code)).size!==drafts.length || current.corrections.some(x=>!drafts.some(y=>y.code===x.code))) throw new Error("RECETTE_Liste de corrections invalide.");

        for(const draft of drafts){const correction=current.corrections.find(x=>x.code===draft.code)!;if(draft.amountMillimes===null || Math.abs(draft.amountMillimes)>100000000000)throw new Error("RECETTE_Montant de correction invalide.");correction.decision=!draft.accepted?"REJECTED":draft.amountMillimes===Math.round(correction.automaticAmount*1000)?"ACCEPTED":"MODIFIED";correction.acceptedAmount=draft.accepted?draft.amountMillimes/1000:0;}

        recomputeAcceptedTotal(current);

      }

      if (cmd === "CONFIRME CORRECTIONS" || cmd.startsWith("CONFIRME CORRECTIONS | DRAFT=")) {

        const verified = verifyRecetteCalculations(session.data, session.calculations!);

        session.calculations = verified.calculations;

        session.final = verified.final;

        session.state = "READY_TO_RECORD";

        session.updatedAt = Date.now();

        const fallback=`✅ تم تأكيد التصحيحات ومراجعتها.\n\n${formatFinalRecette(verified.final)}\n\n⚠️ لم يتم حفظ الوردية أو تغيير المخزون بعد. للحفظ النهائي اضغط التأكيد أو أرسل: OUI ENREGISTRE`;

        const answer=fallback;

        return res.json({

          answer,

          recetteState: "READY_TO_RECORD", recetteData: session.data, recetteCalculations: session.calculations, recetteFinal: session.final,

          requiresConfirmation: false, action: null, preview: null

        });

      }



      const changed = applyCorrectionDecision(session.calculations!, text);

      if (!changed) {

        return res.json({ answer: `${formatCorrectionReview(session.calculations!)}\n\nCommande non reconnue. Exemples : « ACCEPTE TOUT », « REJETTE EAU 0.5L », « MODIFIE CANNETTE = -2.000 ».`, recetteState: "REVIEW_CORRECTIONS", recetteData: session.data, recetteCalculations: session.calculations, requiresConfirmation: false, action: null, preview: null });

      }

      session.updatedAt = Date.now();

      const fallback="Correction mise à jour. Vérifiez le total retenu.";

      const answer=fallback;

      return res.json({ answer, recetteState: "REVIEW_CORRECTIONS", recetteData: session.data, recetteCalculations: session.calculations, requiresConfirmation: false, action: null, preview: null });

    }



    if (session?.state === "READY_TO_RECORD") {

      if (normalizeCommand(text) !== "OUI ENREGISTRE") {

        return res.json({ answer: `${formatFinalRecette(session.final!)}\n\nRien n'est encore enregistré. Pour valider définitivement : OUI ENREGISTRE`, recetteState: "READY_TO_RECORD", recetteData: session.data, recetteCalculations: session.calculations, recetteFinal: session.final, requiresConfirmation: false, action: null, preview: null });

      }

      let recorded: Awaited<ReturnType<typeof recordRecetteAtomically>>;
      try {
        recorded = await recordRecetteAtomically(userId, session);
      } catch (error) {
        // A duplicate is a completed, rejected attempt, not a pending shift.
        // Clear the in-memory session so subsequent messages reach normal chat.
        const raw = error instanceof Error ? error.message : "";
        if (raw.startsWith("RECETTE_") &&
            (raw.includes("مسجلة مسبقاً") || raw.includes("وردية مطابقة"))) {
          recetteSessions.delete(userId);
          return res.json({
            answer: `${raw.slice("RECETTE_".length)}\n\nيمكنك الآن طرح أسئلتك عن المقهى أو بدء /recette جديدة.`,
            requiresConfirmation: false,
            action: null,
            preview: null,
            source: "Saraya duplicate protection"
          });
        }
        throw error;
      }

      session.state = "RECORDED";

      session.recordedShiftId = recorded.shiftId;

      session.updatedAt = Date.now();

      const fallback=`✅ تم حفظ الوردية بنجاح\n\n${formatFinalRecette(recorded.final)}\n\nتم تسجيل الاستهلاك والمبيعات والتصحيحات والمصاريف في PostgreSQL.\nمرجع الوردية: ${recorded.shiftId}`;

      const answer=fallback;

      return res.json({ answer, recetteState: "RECORDED", recetteData: session.data, recetteCalculations: session.calculations, recetteFinal: recorded.final, shiftId: recorded.shiftId, requiresConfirmation: false, action: null, preview: null });

    }



    if (session?.state === "RECORDED" && normalizeCommand(text) === "OUI ENREGISTRE") {

      return res.json({ answer: `Ce shift est déjà enregistré. Aucune deuxième écriture n'a été effectuée.\nRéférence shift : ${session.recordedShiftId}`, recetteState: "RECORDED", shiftId: session.recordedShiftId, requiresConfirmation: false, action: null, preview: null });

    }



    // Existing generic photo analysis remains available outside /recette.

    if (images.length > 0) {

      return res.status(400).json({ error: "Pour la clôture complète, écrivez /recette et joignez exactement 2 photos." });

    }



    const history = body.history ? JSON.parse(body.history) : [];

    const client = await getClient();

    const result = await runTextChat(client, `أجب باللغة العربية وبأسلوب واضح ومختصر. احتفظ بأسماء المنتجات والأرقام كما هي.\n\n${body.message}`, Array.isArray(history) ? history : []);



    if (result.action) {

      const actionId = cryptoRandomId();

      pendingActions.set(actionId, { userId, action: result.action, expiresAt: Date.now() + 5 * 60 * 1000 });

      return res.json({ answer: result.answer, requiresConfirmation: true, actionId, preview: result.preview, action: result.action });

    }



    return res.json({ answer: result.answer, requiresConfirmation: false, action: null, preview: null });

  } catch (error) {

    console.error("CHAT ERROR:", error);

    const message = error instanceof Error && error.message === "NO_OPENAI_KEY"

      ? "Ajoutez votre clé OpenAI dans les paramètres."

      : error instanceof Error && error.message.startsWith("RECETTE_")

        ? error.message.replace("RECETTE_", "")

        : friendlyOpenAIError(error);

    res.status(400).json({ error: message, answer: message });

  }

});



router.post("/confirm", async (req, res) => {

  try {

    const body = z.object({ actionId: z.string() }).parse(req.body);

    const pending = pendingActions.get(body.actionId);

    if (!pending || pending.expiresAt < Date.now() || pending.userId !== (req as import("../types").AuthenticatedRequest).auth!.userId) {

      return res.status(404).json({ error: "Cette action n'est plus disponible." });

    }

    pendingActions.delete(body.actionId);

    const result = await executeAction(pending.action);

    res.json({ answer: result.message });

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Impossible d'exécuter l'action." });

  }

});



router.post("/cancel", async (req, res) => {

  const body = z.object({ actionId: z.string() }).parse(req.body);

  pendingActions.delete(body.actionId);

  res.json({ answer: "Action annulée." });

});



// Owner-editable verification form. Every number is sent once at confirmation.
const recetteNumber = z.number().finite().nonnegative().nullable();
const recetteDraftSchema = z.object({
  stock: z.object({
    worker: z.string().max(120).nullable(),
    lines: z.array(z.object({item:z.string(),start:recetteNumber,ajout:recetteNumber,fin:recetteNumber})).max(200),
    cashCaisse: z.number().finite().nonnegative(),
    depense: recetteNumber,
    staffSalaire: recetteNumber,
    ramiGames: recetteNumber
  }),
  ticket: z.object({
    lines: z.array(z.object({product:z.string(),category:z.string().nullable(),qte:recetteNumber,unitPrice:recetteNumber,total:recetteNumber,ratio:recetteNumber})).max(500),
    ticketTotal: recetteNumber
  })
});
type RecetteDraft = z.infer<typeof recetteDraftSchema>;
function applyOwnerRecetteDraft(current:RecetteData,draft:RecetteDraft):RecetteData {
  if(draft.stock.lines.length!==current.stock.lines.length || draft.ticket.lines.length!==current.ticket.lines.length)
    throw new Error("RECETTE_عدد الأسطر غير مطابق. أعد فتح استمارة التحقق.");
  const result=structuredClone(current);
  result.stock.worker=draft.stock.worker;
  result.stock.cashCaisse=draft.stock.cashCaisse;
  result.stock.depense=draft.stock.depense;
  result.stock.staffSalaire=draft.stock.staffSalaire;
  result.stock.ramiGames=draft.stock.ramiGames;
  for(let i=0;i<result.stock.lines.length;i++) {
    const source=current.stock.lines[i], edited=draft.stock.lines[i];
    if(source.item!==edited.item) throw new Error("RECETTE_لا يمكن تغيير اسم المنتج أثناء المراجعة.");
    Object.assign(result.stock.lines[i],{start:edited.start,ajout:edited.ajout,fin:edited.fin});
    if(edited.start===null || edited.ajout===null || edited.fin===null)
      throw new Error(`RECETTE_الكمية ناقصة للمنتج ${source.item}.`);
    if(edited.start+edited.ajout+0.0005<edited.fin)
      throw new Error(`RECETTE_استهلاك غير صالح للمنتج ${source.item}.`);
  }
  for(let i=0;i<result.ticket.lines.length;i++) {
    const source=current.ticket.lines[i], edited=draft.ticket.lines[i];
    if(source.product!==edited.product) throw new Error("RECETTE_لا يمكن تغيير اسم منتج التذكرة أثناء المراجعة.");
    Object.assign(result.ticket.lines[i],{category:edited.category,qte:edited.qte,unitPrice:edited.unitPrice,total:edited.total,ratio:edited.ratio});
  }
  if(result.ticket.ticketTotal===null && draft.ticket.ticketTotal===null)
    throw new Error("RECETTE_إجمالي المبيعات غير محدد.");
  result.ticket.ticketTotal=draft.ticket.ticketTotal;
  // Explicitly edited prices/totals are preserved. Any discrepancy requires owner's review.
  return result;
}

function parseAndValidateRecette(raw: string): RecetteData {

  let parsed: any;

  try {

    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    parsed = JSON.parse(cleaned);

  } catch {

    throw new Error("RECETTE_OpenAI n'a pas retourné un JSON lisible. Réessayez la demande.");

  }



  // OpenAI can occasionally omit optional/null fields or return a numeric value as text.

  // Normalize those harmless differences here; never invent a missing business value.

  const num = (v: any): number | null => {

    if (v === null || v === undefined || v === "") return null;

    if (typeof v === "number") return Number.isFinite(v) ? v : null;

    if (typeof v === "string") {

      const m = v.trim().replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);

      if (!m) return null;

      const n = Number(m[0]);

      return Number.isFinite(n) ? n : null;

    }

    return null;

  };

  const moneyNum=(v:any):number|null=>{

    if(v==null || v==="") return null;

    if(typeof v==="number") return Number.isFinite(v)?millimesToDinars(v):null;

    if(typeof v==="string") {const m=parseMillimes(v);return m===null?null:m/1000;}

    return null;

  };

  const textOrNull = (v: any) => typeof v === "string" && v.trim() ? v.trim() : null;

  const stock = parsed?.stock ?? {};

  const ticket = parsed?.ticket ?? {};

  const normalized: RecetteData = {

    stock: {

      worker: textOrNull(stock.worker),

      lines: Array.isArray(stock.lines) ? stock.lines.filter((x:any)=>x && (x.item || x.article || x.product)).map((x:any) => ({

        item: String(x.item ?? x.article ?? x.product).trim(), start: num(x.start), ajout: num(x.ajout ?? x.added), fin: num(x.fin ?? x.end),

        unit: textOrNull(x.unit ?? x.unite), confidence: num(x.confidence)

      })) : [],

      cashCaisse: moneyNum(stock.cashCaisse ?? stock.cash_caisse ?? stock.cash),

      depense: moneyNum(stock.depense ?? stock.expense),

      staffSalaire: moneyNum(stock.staffSalaire ?? stock.staff_salaire ?? stock.salary),

      ramiGames: num(stock.ramiGames ?? stock.ramiGame ?? stock.rami_game)

    },

    ticket: {

      lines: Array.isArray(ticket.lines) ? ticket.lines.filter((x:any)=>x && (x.product || x.libelle || x.item)).map((x:any) => {

        const qte=num(x.qte ?? x.quantity); const total=moneyNum(x.total); let unitPrice=moneyNum(x.unitPrice ?? x.unit_price ?? x.prix);

        if (unitPrice === null && qte !== null && qte !== 0 && total !== null) unitPrice = Math.round((total/qte)*1000)/1000;

        return { category:textOrNull(x.category ?? x.categorie), product:String(x.product ?? x.libelle ?? x.item).trim(), qte, ratio:num(x.ratio), unitPrice, total, confidence:num(x.confidence) };

      }) : [],

      ticketTotal: moneyNum(ticket.ticketTotal ?? ticket.ticket_total ?? ticket.totalArticles ?? ticket.total_articles)

    },

    notes: Array.isArray(parsed?.notes) ? parsed.notes.filter((x:any)=>typeof x === "string") : []

  };



  if (!normalized.stock.lines.length || !normalized.ticket.lines.length) {

    throw new Error("RECETTE_Les deux documents ont été reçus, mais OpenAI n'a pas identifié les lignes stock et ticket. Vérifiez que les deux documents complets sont visibles.");

  }

  return normalized;

}



async function applyRecetteEdit(client: ReturnType<typeof getOpenAI>, model: string, current: RecetteData, instruction: string) {

  const completion = await client.chat.completions.create({

    model,

    messages: [{

      role: "user",

      content: `${RECETTE_EDIT_PROMPT}\n\nJSON ACTUEL:\n${JSON.stringify(current)}\n\nCORRECTION DU PROPRIÉTAIRE:\n${instruction}`

    }],

    temperature: 0,

    response_format: { type: "json_object" }

  });

  return parseAndValidateRecette(completion.choices[0]?.message?.content || "");

}



function formatRecetteReview(data: RecetteData, afterEdit: boolean) {

  const n = (v: number | null) => v == null ? "?" : String(v);

  const money = (v: number | null) => v == null ? "?" : `${v.toFixed(3)} DT`;

  const stockLines = data.stock.lines.length

    ? data.stock.lines.map((x) => `• ${x.item}: START ${n(x.start)} | AJOUT ${n(x.ajout)} | FIN ${n(x.fin)}${x.unit ? ` ${x.unit}` : ""}`).join("\n")

    : "• Aucune ligne stock lisible";

  const sales = data.ticket.lines.length

    ? data.ticket.lines.map((x) => `• ${x.category || "?"} — ${x.product}: Qte ${n(x.qte)} | Ratio ${n(x.ratio)} | Prix ${money(x.unitPrice)} | Total ${money(x.total)}`).join("\n")

    : "• Aucune ligne ticket lisible";

  const notes = data.notes.length ? `\n\n⚠️ Notes de lecture:\n${data.notes.map((x) => `• ${x}`).join("\n")}` : "";



  return `${afterEdit ? "Vérifiez de nouveau les données :" : "J'ai extrait les 2 photos. Vérifiez toutes les données avant de continuer."}\n\nFEUILLE STOCK\nالعامل: ${data.stock.worker || "?"}\n${stockLines}\n\nالنقد في الصندوق: ${money(data.stock.cashCaisse)}\nDépense: ${money(data.stock.depense)}\nأجور العاملين: ${money(data.stock.staffSalaire)}\nRami Games: ${n(data.stock.ramiGames)}\n\nTICKET CAISSE\n${sales}\n\nTotal ticket: ${money(data.ticket.ticketTotal)}${notes}\n\nSi une valeur est fausse, écrivez simplement la correction (ex. « EAU 0.5L FIN = 12 » ou « MENTHE Qte = 8 »).\nQuand tout est correct, envoyez exactement : CONFIRME DONNÉES`;

}



function stripPrintedUnit(name: string): string {
  return name.trim().replace(/\s*\((?:g|kg|l|litre|litres|pcs|pc|piece|pieces|pièce|pièces)\)\s*$/i, "").trim();
}

function canonical(value: string) {

  return normalizeCommand(stripPrintedUnit(value)).replace(/[^A-Z0-9.]+/g, " ").trim();

}



function actualConsumption(data: RecetteData, names: string[]) {

  const wanted = names.map(canonical);

  const line = data.stock.lines.find(x => wanted.includes(canonical(x.item)));

  if (!line || line.start == null || line.ajout == null || line.fin == null) return null;

  return round3(line.start + line.ajout - line.fin);

}



function sold(data: RecetteData, names: string[]) {

  const wanted = names.map(canonical);

  return round3(data.ticket.lines.filter(x => wanted.includes(canonical(x.product))).reduce((sum, x) => sum + (x.qte || 0), 0));

}



function makeCorrection(code: string, label: string, actual: number | null, expected: number, positivePrice: number, negativePrice = positivePrice, positiveLabel = "prix article", negativeLabel = positiveLabel): RecetteCorrection | null {

  if (actual == null) return null;

  const difference = round3(actual - expected);

  const price = difference >= 0 ? positivePrice : negativePrice;

  const amount = round3(difference * price);

  return { code, label, actual, expected: round3(expected), difference, price, priceLabel: difference >= 0 ? positiveLabel : negativeLabel, automaticAmount: amount, acceptedAmount: 0, decision: "PENDING", note: difference === 0 ? "Aucun écart" : difference > 0 ? "Consommation réelle supérieure aux ventes attendues" : "Ventes attendues supérieures à la consommation réelle" };

}



function calculateRecette(data: RecetteData): RecetteCalculations {

  const corrections: RecetteCorrection[] = [];

  const push = (x: RecetteCorrection | null) => { if (x) corrections.push(x); };

  push(makeCorrection("EAU_15", "EAU 1.5L", actualConsumption(data,["EAU 1.5L"]), sold(data,["EAU 1.5L"]), 1.5));

  const eau05Expected = sold(data,["EAU 0.5L"]) + sold(data,["KAMIA"]);

  push(makeCorrection("EAU_05", "EAU 0.5L (+ KAMIA)", actualConsumption(data,["EAU 0.5L"]), eau05Expected, 5.0, 0.8, "prix CHICHA", "prix EAU 0.5L"));

  push(makeCorrection("EAU_1L", "EAU 1L", actualConsumption(data,["EAU 1L"]), sold(data,["EAU 1L"]), 1.5));

  push(makeCorrection("GAZEUSE", "GAZEUSE", actualConsumption(data,["GAZEUSE"]), sold(data,["BOISSON GAZEUZE","GAZEUSE"]), 1.5));

  push(makeCorrection("CANNETTE", "CANNETTE", actualConsumption(data,["CANNETTE","CANETTE"]), sold(data,["CANETTE","CANNETTE"]), 2.0));

  const citronActual = actualConsumption(data,["CITRON"]);

  const citronSold = sold(data,["CITRON"]);

  if (citronActual != null) {

    const expectedL = round3(citronSold * 0.2);

    const diffL = round3(citronActual - expectedL);

    const cups = round3(diffL / 0.2);

    const amount = round3(cups * 2.5);

    corrections.push({ code:"CITRON", label:"CITRON", actual:citronActual, expected:expectedL, difference:diffL, price:2.5, priceLabel:"2.500 DT / verre (0.2 L)", automaticAmount:amount, acceptedAmount:0, decision:"PENDING", note:`Écart ${diffL.toFixed(3)} L = ${cups.toFixed(3)} verre(s)` });

  }

  const coffeeNames=["CAPUCIN","DIRECT","EXPRESS","FILTRE","AMERICAIN","SPECIALE","ALLONGE","DEMI ALLONGE","SANS MOUSSE","SERRE"];

  const soldCoffees=sold(data,coffeeNames);

  const beansConsumed=actualConsumption(data,["COFFEE BEANS","CAFE GRAINS","CAFÉ GRAINS"]);

  const coffeeRatio=beansConsumed && beansConsumed!==0 ? round3(soldCoffees/beansConsumed) : null;

  const chichaLines=data.ticket.lines.filter(x=>canonical(x.category||"")==="CHICHA");

  const total=round3(chichaLines.reduce((a,x)=>a+(x.qte||0),0));

  const personnel=round3(chichaLines.filter(x=>canonical(x.product).includes("PERSONEL")||canonical(x.product).includes("PERSONNEL")).reduce((a,x)=>a+(x.qte||0),0));

  const normal=round3(total-personnel);

  const tombacConsumed=actualConsumption(data,["TOMBAC","TAMBAC"]);

  const tombacRatio=tombacConsumed!=null && normal>0 ? round3(tombacConsumed/normal) : null;

  const automaticCorrectionTotal=round3(corrections.reduce((a,x)=>a+x.automaticAmount,0));

  return { corrections, automaticCorrectionTotal, acceptedCorrectionTotal: 0, coffee:{soldCoffees,beansConsumed,coffeesPerBeanUnit:coffeeRatio}, chicha:{total,personnel,normal,tombacConsumed,tombacPerNormalChicha:tombacRatio} };

}



// Exact monetary normalization: accepts 535.600 or 535,600 as 535600 millimes.

function parseMillimes(input: string): number | null {

  const raw=input.trim().replace(/\s*DT\s*$/i, "").replace(/[\u00a0\u202f ]/g, "");

  if(!/^-?\d+(?:[.,]\d{1,3})?$/.test(raw)) return null;

  const negative=raw.startsWith("-");

  const parts=(negative?raw.slice(1):raw).split(/[.,]/);

  const mills=Number(parts[0])*1000+Number((parts[1]||"").padEnd(3,"0"));

  return Number.isSafeInteger(mills) ? (negative?-mills:mills) : null;

}

function millimesToDinars(v: number): number { return Math.round(v*1000)/1000; }



function recomputeAcceptedTotal(c: RecetteCalculations) { c.acceptedCorrectionTotal=c.corrections.reduce((a,x)=>a+Math.round(x.acceptedAmount*1000),0)/1000; }



function applyCorrectionDecision(c: RecetteCalculations, text: string) {

  const cmd=normalizeCommand(text);





  const action = cmd.startsWith("ACCEPTE ") ? "ACCEPTED" : cmd.startsWith("REJETTE ") ? "REJECTED" : cmd.startsWith("MODIFIE ") || cmd.startsWith("QUANTITE ") ? "MODIFIED" : null;

  if (!action) return false;

  const targetText=cmd.replace(/^(ACCEPTE|REJETTE|MODIFIE|QUANTITE)\s+/,"").split("=")[0].trim();

  const target=c.corrections.find(x=>canonical(x.label).includes(canonical(targetText)) || canonical(x.code)===canonical(targetText));

  if (!target) return false;

  if (action === "ACCEPTED") { target.decision="ACCEPTED";target.acceptedAmount=target.automaticAmount; }

  else if (action === "REJECTED") { target.decision="REJECTED";target.acceptedAmount=0; }

  else {

    const raw=text.split("=").slice(1).join("=").trim();

    const quantityMode=cmd.startsWith("QUANTITE ");

    const quantity=Number(raw.replace(",","."));

    if(quantityMode && (!/^[0-9]+(?:[.,][0-9]{1,3})?$/.test(raw) || !Number.isFinite(quantity) || quantity>Math.abs(target.difference))) return false;

    const mills=quantityMode ? Math.round(Math.sign(target.automaticAmount)*quantity*1000*(Math.abs(target.automaticAmount)/Math.abs(target.difference))) : parseMillimes(raw);

    if(mills===null || !Number.isSafeInteger(mills)) return false;

    const maximum=Math.abs(Math.round(target.automaticAmount*1000));

    if(Math.abs(mills)>maximum || (mills!==0 && Math.sign(mills)!==Math.sign(target.automaticAmount))) return false;

    target.decision="MODIFIED";target.acceptedAmount=mills/1000;

  }

  recomputeAcceptedTotal(c); return true;

}



function formatCorrectionReview(c: RecetteCalculations) {
  const lines = c.corrections.map(x => `• ${x.label}: الاستهلاك ${x.actual} | المبيعات المتوقعة ${x.expected} | الفرق ${x.difference} | التصحيح المقترح ${money3(x.automaticAmount)} | المعتمد ${money3(x.acceptedAmount)} | ${x.decision}`);
  return `📋 مراجعة التصحيحات\n\n${lines.join("\n")}\n\nإجمالي التصحيحات المقترحة: ${money3(c.automaticCorrectionTotal)}\nإجمالي التصحيحات المعتمدة: ${money3(c.acceptedCorrectionTotal)}\n\nللمتابعة أرسل: CONFIRME CORRECTIONS`;
}


function applyMockRecetteEdit(data: RecetteData, instruction: string): RecetteData {

  const out=structuredClone(data);

  const m=instruction.match(/^(.+?)\s+(START|AJOUT|FIN)\s*=\s*(-?\d+(?:[.,]\d+)?)$/i);

  if(m){ const line=out.stock.lines.find(x=>canonical(x.item)===canonical(m[1])); if(!line) throw new Error("RECETTE_Article stock mock introuvable."); (line as any)[m[2].toLowerCase()]=Number(m[3].replace(",",".")); return out; }

  const q=instruction.match(/^(.+?)\s+QTE\s*=\s*(-?\d+(?:[.,]\d+)?)$/i);

  if(q){ const line=out.ticket.lines.find(x=>canonical(x.product)===canonical(q[1])); if(!line) throw new Error("RECETTE_Produit ticket mock introuvable."); line.qte=Number(q[2].replace(",",".")); return out; }

  throw new Error("RECETTE_En mode mock, utilisez par exemple « EAU 0.5L FIN = 12 » ou « MENTHE Qte = 8 ».");

}





function verifyRecetteCalculations(data: RecetteData, owner: RecetteCalculations) {

  const fresh = calculateRecette(data);

  const byCode = new Map(owner.corrections.map(x => [x.code, x]));

  if (fresh.corrections.length !== owner.corrections.length) throw new Error("RECETTE_La vérification finale a détecté un changement dans les corrections.");

  for (const correction of fresh.corrections) {

    const prior = byCode.get(correction.code);

    if (!prior || Math.abs(prior.automaticAmount - correction.automaticAmount) > 0.0005) throw new Error(`RECETTE_La correction ${correction.label} ne correspond plus au calcul backend.`);

    if (prior.decision === "PENDING") throw new Error(`RECETTE_Décision manquante pour ${correction.label}. Acceptez, rejetez ou modifiez cette correction avant de confirmer.`);

    correction.decision = prior.decision;

    correction.acceptedAmount = prior.decision === "ACCEPTED" ? correction.automaticAmount : prior.decision === "REJECTED" ? 0 : round3(prior.acceptedAmount);

  }

  recomputeAcceptedTotal(fresh);

  const cash = requiredMoney(data.stock.cashCaisse, "Cash caisse");

  const depense = requiredMoney(data.stock.depense, "Dépense");

  const salary = requiredMoney(data.stock.staffSalaire, "Staff salaire");

  const games = requiredMoney(data.stock.ramiGames, "Rami Games");

  const ticket = requiredMoney(data.ticket.ticketTotal, "Total ticket");

  const ramiMultiplier = 1.5;

  const ramiValue = Math.round(games * 1500)/1000;

  const before = (Math.round(cash*1000)+Math.round(ramiValue*1000)-Math.round(depense*1000)-Math.round(salary*1000))/1000;

  const final: RecetteFinal = { cashCaisse:cash, ramiGames:games, ramiMultiplier, ramiValue, depense, staffSalaire:salary, automaticCorrectionTotal:fresh.automaticCorrectionTotal, acceptedCorrectionTotal:fresh.acceptedCorrectionTotal, recetteBeforeCorrection:before, recetteFinale:(Math.round(before*1000)+Math.round(fresh.acceptedCorrectionTotal*1000))/1000, ticketTotal:ticket };

  return { calculations: fresh, final };

}



function requiredMoney(value: number | null, label: string) {

  if (value == null || !Number.isFinite(value)) throw new Error(`RECETTE_${label} est manquant ou invalide.`);

  return round3(value);

}



function formatFinalRecette(f: RecetteFinal) {
  return `💰 حصيلة الوردية\n\nالنقد في الصندوق: ${money3(f.cashCaisse)}\nRami Games: ${f.ramiGames} × ${f.ramiMultiplier.toFixed(3)} = +${money3(f.ramiValue)}\nالتصحيحات المعتمدة: ${money3(f.acceptedCorrectionTotal)}\nالمصاريف: -${money3(f.depense)}\nأجور العاملين: -${money3(f.staffSalaire)}\n\nالحصيلة النهائية = ${money3(f.recetteFinale)}\nإجمالي المبيعات حسب التذكرة (منفصل): ${money3(f.ticketTotal)}`;
}


function sourceFingerprint(userId:string,data:RecetteData,model?:string,sessionCreatedAt?:number,photoHash?:string) {
  // Raw photo digest is stable even when AI extracts different values on retry.
  // The DB has a UNIQUE index on Shift.sourceFingerprint.
  if(photoHash) return createHash("sha256").update("SARAYA_PHOTOS_V2:"+userId+":"+photoHash).digest("hex");
  return createHash("sha256").update(JSON.stringify({userId,data,model,nonce:model==="mock"?sessionCreatedAt:undefined})).digest("hex");
}

function businessDataFingerprint(data:RecetteData) {
  const lines=data.stock.lines.map(x=>[canonical(stripPrintedUnit(x.item)),x.start,x.ajout,x.fin]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const sales=data.ticket.lines.map(x=>[canonical(x.product),x.qte,x.total]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify({lines,sales,total:data.ticket.ticketTotal})).digest("hex");
}

async function findMatchingRecordedShift(data:RecetteData,shopId:string) {
  // Second guard catches identical shifts even if photos were recompressed.
  // Same-day identical legitimate shifts are blocked for technician review.
  const since=new Date(Date.now()-48*60*60*1000);
  const shifts=await prisma.shift.findMany({where:{shopId,status:"RECORDED",recordedAt:{gte:since}},include:{extractions:true},take:100,orderBy:{recordedAt:"desc"}});
  const target=businessDataFingerprint(data);
  for(const shift of shifts) for(const extraction of shift.extractions) {
    const prior=extraction.validatedJson as unknown as RecetteData;
    if(prior?.stock?.lines && prior?.ticket?.lines && businessDataFingerprint(prior)===target) return shift;
  }
  return null;
}

function itemAlias(name: string) {

  const c=canonical(name);

  if (c === "CANETTE" || c === "CANNETTE") return "CANNETTE";

  if (c === "BOISSON GAZEUZE" || c === "GAZEUSE") return "GAZEUSE";

  return name.trim().toUpperCase();

}



// PostgreSQL is the single authoritative unit source. Never convert or silently correct conflicts.
function normalizeStockUnit(unit: string | null | undefined): string {
  const value = (unit || "").trim().toLowerCase();
  const aliases: Record<string,string> = {
    "gramme":"g", "grammes":"g", "kilogramme":"kg", "kilogrammes":"kg",
    "litre":"l", "litres":"l", "liter":"l", "liters":"l",
    "pc":"pcs", "piece":"pcs", "pieces":"pcs", "pièce":"pcs", "pièces":"pcs"
  };
  return aliases[value] || value;
}

function unitProblem(item: string, paper: string, database: string): Error {
  return new Error(`RECETTE_⚠️ توجد مشكلة تقنية في وحدة قياس ${item}. الوحدة في ورقة العمل: ${paper}، والوحدة في قاعدة البيانات: ${database}. لم يتم تسجيل الوردية ولم يتم خصم أي كمية من المخزون. يُرجى الاتصال بفني التطبيق أو المهندس لإصلاح المشكلة.`);
}

async function synchronizeRecetteUnits(data: RecetteData): Promise<void> {
  const items = await prisma.item.findMany({ where: { archivedAt: null } });
  const itemMap = new Map(items.map(item => [canonical(item.name), item]));
  for (const line of data.stock.lines) {
    const suffix = line.item.match(/\s*\((g|kg|l|litre|litres|pcs|pc|piece|pieces|pièce|pièces)\)\s*$/i);
    const printed = suffix?.[1] || null;
    const extracted = line.unit;
    const item = itemMap.get(canonical(itemAlias(stripPrintedUnit(line.item)))) || itemMap.get(canonical(line.item));
    if (!item) {
      throw new Error(`RECETTE_⚠️ المنتج ${line.item} غير موجود في المخزون. لم يتم حفظ الوردية. يُرجى الاتصال بفني التطبيق أو المهندس.`);
    }
    const dbUnit = normalizeStockUnit(item.unit);
    if (!dbUnit || !["g","kg","l","pcs"].includes(dbUnit)) {
      throw unitProblem(line.item, printed || extracted || "غير محددة", item.unit || "غير محددة");
    }
    if (printed && extracted && normalizeStockUnit(printed) !== normalizeStockUnit(extracted)) {
      throw unitProblem(line.item, `${printed} / ${extracted}`, item.unit || "غير محددة");
    }
    const paperUnit = printed || extracted;
    if (paperUnit && normalizeStockUnit(paperUnit) !== dbUnit) {
      throw unitProblem(line.item, paperUnit, item.unit || "غير محددة");
    }
    line.item = stripPrintedUnit(line.item);
    line.unit = item.unit;
  }
}

async function recordRecetteAtomically(userId: string, session: RecetteSession) {
  await synchronizeRecetteUnits(session.data);

  const verified = verifyRecetteCalculations(session.data, session.calculations!);

  const currentShop = await prisma.shop.findFirst();
  if (!currentShop) throw new Error("RECETTE_المقهى غير موجود في النظام.");
  const fingerprint = sourceFingerprint(currentShop.id, session.data, session.model, session.createdAt, session.sourcePhotoHash);

  const existing = await prisma.shift.findUnique({ where: { sourceFingerprint: fingerprint } });

    if (existing) throw new Error(`RECETTE_⚠️ هذه الوردية مسجلة مسبقاً (${existing.id}). لم يتم خصم أي مخزون إضافي. اتصل بفني التطبيق إذا كانت وردية مختلفة.`);
  const similar = await findMatchingRecordedShift(session.data,currentShop.id);
  if(similar) throw new Error(`RECETTE_⚠️ تم العثور على وردية مطابقة مسجلة مسبقاً (${similar.id}). لم يتم خصم أي مخزون إضافي. إذا كانت وردية أخرى بالفعل فاتصل بفني التطبيق.`);



  return prisma.$transaction(async tx => {

    const duplicate = await tx.shift.findUnique({ where: { sourceFingerprint: fingerprint } });

    if (duplicate) throw new Error(`RECETTE_⚠️ هذه الوردية مسجلة مسبقاً (${duplicate.id}). لم يتم خصم أي مخزون إضافي.`);

    const shop = await tx.shop.findFirst();

    if (!shop) throw new Error("RECETTE_Aucun commerce Saraya n'est configuré.");

    const workerName = session.data.stock.worker?.trim() || "INCONNU";

    const worker = await tx.worker.upsert({ where: { shopId_name: { shopId: shop.id, name: workerName } }, update: { active:true }, create: { shopId:shop.id, name:workerName } });

    const now = new Date();

    const shift = await tx.shift.create({ data: {

      shopId:shop.id, workerId:worker.id, shiftType:"RECETTE", businessDate:now,

      cashExpected:verified.final.ticketTotal, cashCounted:verified.final.cashCaisse, cashVariance:round3(verified.final.cashCaisse-verified.final.ticketTotal),

      cashCaisse:verified.final.cashCaisse, ramiGames:verified.final.ramiGames, ramiMultiplier:verified.final.ramiMultiplier, ramiValue:verified.final.ramiValue,

      ticketTotal:verified.final.ticketTotal, expenseTotal:verified.final.depense, staffSalary:verified.final.staffSalaire,

      automaticCorrectionTotal:verified.final.automaticCorrectionTotal, acceptedCorrectionTotal:verified.final.acceptedCorrectionTotal,

      recetteBeforeCorrection:verified.final.recetteBeforeCorrection, recetteFinale:verified.final.recetteFinale,

      status:"RECORDED", dataConfirmedAt:now, correctionsConfirmedAt:now, recordedAt:now, sourceFingerprint:fingerprint,

      notes: session.model === "mock" ? "Phase 3 /recette — mode mock" : "Phase 3 /recette"

    }});



    const items = await tx.item.findMany({ where:{ archivedAt:null } });

    const itemMap = new Map(items.map(i=>[canonical(i.name),i]));

    for (const line of session.data.stock.lines) {

      const consumed = line.start == null || line.ajout == null || line.fin == null ? null : round3(line.start + line.ajout - line.fin);

      if (consumed != null && consumed < -0.0005) throw new Error(`RECETTE_Stock invalide pour ${line.item}: la consommation calculée est négative.`);

      const item = itemMap.get(canonical(itemAlias(line.item))) || itemMap.get(canonical(line.item));

      const original = session.originalData.stock.lines.find(x=>canonical(x.item)===canonical(line.item));

      await tx.shiftStockLine.create({ data:{ shiftId:shift.id, itemId:item?.id, rawItemName:line.item, normalizedItemName:canonical(line.item), unit:line.unit, startQty:line.start, addedQty:line.ajout, endQty:line.fin, consumedQty:consumed, aiStartQty:original?.start, aiAddedQty:original?.ajout, aiEndQty:original?.fin, extractionConfidence:line.confidence, wasOwnerModified:JSON.stringify(original)!==JSON.stringify(line), originalExtractedValue:(original || line) as any } });

      if (item && consumed != null && consumed > 0) {

        await tx.shiftItem.create({ data:{ shiftId:shift.id, itemId:item.id, consumedQty:consumed } });

        const before=item.quantity;

        // IMPORTANT: START/AJOUT/FIN describe only the shift working stock, not the whole master inventory.

        // Therefore FIN NEVER replaces Item.quantity. We deduct only physical consumption from master stock.

        if (normalizeStockUnit(line.unit) !== normalizeStockUnit(item.unit)) {
          throw unitProblem(line.item, line.unit || "غير محددة", item.unit || "غير محددة");
        }
        const consumedInMasterUnit = consumed;

        const after=round3(before-consumedInMasterUnit);

        if (after < -0.0005) throw new Error(`RECETTE_Stock insuffisant pour ${line.item}: ${before} ${item.unit} disponible, ${consumedInMasterUnit} ${item.unit} consommé.`);

        await tx.item.update({ where:{id:item.id}, data:{quantity:after} });

        await tx.stockMovement.create({ data:{ itemId:item.id, shiftId:shift.id, type:"OUT", quantity:-consumedInMasterUnit, quantityBefore:before, quantityAfter:after, source:"RECETTE", note:`/recette: consommation shift ${consumed} ${line.unit || item.unit} = ${consumedInMasterUnit} ${item.unit}; stock maître ${before} -> ${after}` } });

      }

    }



    const products = await tx.product.findMany({ where:{shopId:shop.id} });

    const productMap = new Map(products.map(p=>[canonical(p.posName),p]));

    for (const line of session.data.ticket.lines) {

      const product=productMap.get(canonical(line.product));

      const original=session.originalData.ticket.lines.find(x=>canonical(x.product)===canonical(line.product));

      await tx.shiftSaleLine.create({ data:{ shiftId:shift.id, productId:product?.id, category:line.category || "INCONNU", rawProductName:line.product, normalizedProductName:canonical(line.product), quantity:line.qte || 0, ratio:line.ratio, unitPrice:line.unitPrice, lineTotal:line.total, extractionConfidence:line.confidence, wasOwnerModified:JSON.stringify(original)!==JSON.stringify(line), originalExtractedValue:(original || line) as any } });

    }



    for (const c of verified.calculations.corrections) {

      const itemName = c.code === "EAU_15" ? "EAU 1.5L" : c.code === "EAU_05" ? "EAU 0.5L" : c.code === "EAU_1L" ? "EAU 1L" : c.code;

      const item=itemMap.get(canonical(itemName));

      await tx.shiftCorrection.create({ data:{ shiftId:shift.id, itemId:item?.id, correctionCode:c.code, expectedQty:c.expected, actualConsumedQty:c.actual, differenceQty:c.difference, calculationRule:c.note, priceUsed:c.price, automaticAmount:c.automaticAmount, acceptedAmount:c.acceptedAmount, decision:c.decision, ownerReason:c.decision === "MODIFIED" ? "Montant modifié par le propriétaire" : null, ownerModifiedAt:c.decision === "MODIFIED" ? now : null } });

    }



    if (verified.final.depense !== 0) await tx.shiftExpense.create({ data:{shiftId:shift.id,type:"DEPENSE",description:"Dépense shift",amount:verified.final.depense} });

    if (verified.final.staffSalaire !== 0) await tx.shiftExpense.create({ data:{shiftId:shift.id,type:"STAFF_SALARY",description:"Salaire staff",amount:verified.final.staffSalaire} });

    const metricUnit = (names: string[], fallback: string) => session.data.stock.lines.find(x => names.includes(canonical(x.item)))?.unit || fallback;
      const coffeeUnit = metricUnit(["COFFEE BEANS", "CAFE GRAINS"], "g");
      const tombacUnit = metricUnit(["TOMBAC", "TAMBAC"], "g");
      const metrics = [

      ["COFFEE_SOLD",verified.calculations.coffee.soldCoffees,"coffee"], ["COFFEE_BEANS_CONSUMED",verified.calculations.coffee.beansConsumed,coffeeUnit], ["COFFEES_PER_BEAN_UNIT",verified.calculations.coffee.coffeesPerBeanUnit,`coffee/${coffeeUnit}`],

      ["CHICHA_TOTAL",verified.calculations.chicha.total,"chicha"], ["CHICHA_PERSONNEL",verified.calculations.chicha.personnel,"chicha"], ["CHICHA_NORMAL",verified.calculations.chicha.normal,"chicha"], ["TOMBAC_CONSUMED",verified.calculations.chicha.tombacConsumed,tombacUnit], ["TOMBAC_PER_NORMAL_CHICHA",verified.calculations.chicha.tombacPerNormalChicha,`${tombacUnit}/chicha`]

    ] as const;

    for (const [metricCode,value,unit] of metrics) if (value != null) await tx.shiftMetric.create({data:{shiftId:shift.id,metricCode,value,unit}});

    await tx.shiftExtraction.create({data:{shiftId:shift.id,sourceType:session.model === "mock" ? "MOCK" : "TWO_IMAGES",extractedJson:session.originalData as any,validatedJson:session.data as any,aiModel:session.model,sourceHash:fingerprint,validatedAt:now}});

    await tx.shiftAuditEvent.createMany({data:[

      {shiftId:shift.id,eventType:"DATA_CONFIRMED",payload:{at:now.toISOString()}},

      {shiftId:shift.id,eventType:"CORRECTIONS_CONFIRMED",payload:{acceptedTotal:verified.final.acceptedCorrectionTotal}},

      {shiftId:shift.id,eventType:"RECORDED",payload:{recetteFinale:verified.final.recetteFinale,userId}}

    ]});

    return { shiftId:shift.id, final:verified.final };

  });

}



function normalizeUnit(unit: string | null | undefined) {

  return (unit || "").trim().toLowerCase().replace("litres","l").replace("litre","l").replace("pieces","pcs").replace("piece","pcs");

}



function convertStockQuantity(value: number, fromUnit: string | null, toUnit: string | null) {
  if (normalizeStockUnit(fromUnit) !== normalizeStockUnit(toUnit)) {
    throw unitProblem("article", fromUnit || "غير محددة", toUnit || "غير محددة");
  }
  return round3(value);
}


async function runAnalyticsCommand(raw: string) {

  const cmd=normalizeCommand(raw);

  const shop=await prisma.shop.findFirst();

  if (!shop) throw new Error("RECETTE_Aucun commerce Saraya n'est configuré.");

  const now=new Date();

  const daysMatch=cmd.match(/^\/?(?:ANALYSE|ANALYTICS)\s+(\d{1,3})J?$/);

  const days=daysMatch ? Math.max(1, Math.min(365, Number(daysMatch[1]))) : 7;



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+(?:AIDE|HELP)$/.test(cmd) || cmd === "/ANALYSE" || cmd === "/ANALYTICS") {

    return `📊 تحليلات سرايا\n\nالأوامر المتاحة:\n/analyse dernier — آخر وردية محفوظة\n/analyse 7j — ملخص آخر 7 أيام (1 à 365)\n/analyse stock — المخزون الحالي وآخر عمليات الخصم\n/analyse approvisionnement — سجل إضافة المخزون خلال 30 يوماً\n/analyse corrections — التصحيحات المقترحة والمعتمدة\n/analyse ventes — المنتجات الأكثر مبيعاً\n/analyse cafe — تحليل القهوة والبن\n/analyse chicha — تحليل الشيشة والتبغ\n\nهذه النتائج مأخوذة من قاعدة بيانات PostgreSQL دون طلب إضافي إلى OpenAI.`;

  }



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+DERNIER$/.test(cmd)) {

    const shift=await prisma.shift.findFirst({where:{shopId:shop.id,status:"RECORDED"},orderBy:{recordedAt:"desc"},include:{worker:true,corrections:true,metrics:true}});

    if (!shift) return "📊 لا توجد ورديات محفوظة حتى الآن.";

    return `📊 آخر وردية\n\nالعامل: ${shift.worker?.name || "INCONNU"}\nالحصيلة النهائية: ${money3(Number(shift.recetteFinale || 0))}\nالنقد في الصندوق: ${money3(Number(shift.cashCaisse || 0))}\nإجمالي التذكرة: ${money3(Number(shift.ticketTotal || 0))}\nالتصحيحات المعتمدة: ${money3(Number(shift.acceptedCorrectionTotal || 0))}\nالمصاريف: ${money3(Number(shift.expenseTotal || 0))}\nأجور العاملين: ${money3(Number(shift.staffSalary || 0))}\nالتصحيحات: ${shift.corrections.length}\nتاريخ الحفظ: ${(shift.recordedAt || shift.closedAt).toLocaleString("fr-FR")}`;

  }



  const since=new Date(now.getTime()-days*24*60*60*1000);

  if (daysMatch) {

    const shifts=await prisma.shift.findMany({where:{shopId:shop.id,status:"RECORDED",recordedAt:{gte:since}},orderBy:{recordedAt:"desc"}});

    if (!shifts.length) return `📊 لا توجد ورديات محفوظة خلال آخر ${days} derniers jours.`;

    const sum=(key:string)=>round3(shifts.reduce((a:any,s:any)=>a+Number(s[key] || 0),0));

    return `📊 ملخص — ${days} أيام\n\nالورديات: ${shifts.length}\nإجمالي الحصيلة: ${money3(sum("recetteFinale"))}\nالمتوسط لكل وردية: ${money3(sum("recetteFinale")/shifts.length)}\nإجمالي النقد: ${money3(sum("cashCaisse"))}\nإجمالي التذاكر: ${money3(sum("ticketTotal"))}\nالتصحيحات المقترحة: ${money3(sum("automaticCorrectionTotal"))}\nالتصحيحات المعتمدة: ${money3(sum("acceptedCorrectionTotal"))}\nالمصاريف: ${money3(sum("expenseTotal"))}\nأجور العاملين: ${money3(sum("staffSalary"))}`;

  }



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+STOCK$/.test(cmd)) {

    const items=await prisma.item.findMany({where:{archivedAt:null},orderBy:{name:"asc"}});

    const movements=await prisma.stockMovement.findMany({where:{source:"RECETTE"},orderBy:{createdAt:"desc"},take:8,include:{item:true}});

    return `📦 STOCK ACTUEL\n\n${items.map(i=>`• ${i.name}: ${round3(i.quantity)} ${i.unit}`).join("\n")}\n\nDernières consommations /recette :\n${movements.length?movements.map(m=>`• ${m.item.name}: ${round3(Math.abs(m.quantity))} ${m.item.unit} consommé | ${round3(m.quantityBefore ?? 0)} → ${round3(m.quantityAfter ?? 0)}`).join("\n"):"Aucune."}`;

  }



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+(?:APPROVISIONNEMENT|APPRO|AJOUTS?|REAPPROVISIONNEMENT)$/.test(cmd)) {

    const since30=new Date(now.getTime()-30*24*60*60*1000);

    const movements=await prisma.stockMovement.findMany({

      where:{type:"IN",source:{in:["MANUAL","CHAT"]},createdAt:{gte:since30},item:{archivedAt:null}},

      include:{item:true},orderBy:{createdAt:"asc"}

    });

    if (!movements.length) return "📥 APPROVISIONNEMENT — 30 أيام\n\nAucun ajout de stock enregistré sur les 30 derniers jours.";

    const grouped=new Map<string, typeof movements>();

    for (const m of movements) grouped.set(m.itemId,[...(grouped.get(m.itemId)||[]),m]);

    const rows=[...grouped.values()].map(list=>{

      const item=list[0].item;

      const total=round3(list.reduce((a,m)=>a+Number(m.quantity),0));

      const avg=round3(total/list.length);

      const intervals:number[]=[];

      for(let i=1;i<list.length;i++) intervals.push((list[i].createdAt.getTime()-list[i-1].createdAt.getTime())/(24*60*60*1000));

      const avgDays=intervals.length?round3(intervals.reduce((a,v)=>a+v,0)/intervals.length):null;

      const last=list[list.length-1];

      return {item,total,avg,count:list.length,avgDays,last};

    }).sort((a,b)=>b.total-a.total);

    return `📥 APPROVISIONNEMENT — 30 أيام\n\n${rows.map(r=>`• ${r.item.name}: ${r.count} ajout(s) | +${r.total} ${r.item.unit} au total | moyenne +${r.avg} ${r.item.unit}${r.avgDays!==null?` | rythme ≈ tous les ${r.avgDays} jours`:" | rythme: pas encore calculable"}\n  Dernier ajout: +${round3(r.last.quantity)} ${r.item.unit} le ${r.last.createdAt.toLocaleString("fr-FR")}${r.last.quantityBefore!==null&&r.last.quantityAfter!==null?` | ${round3(r.last.quantityBefore)} → ${round3(r.last.quantityAfter)}`:""}`).join("\n")}`;

  }



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+CORRECTIONS$/.test(cmd)) {

    const rows=await prisma.shiftCorrection.findMany({where:{shift:{shopId:shop.id,status:"RECORDED",recordedAt:{gte:since}}},orderBy:{createdAt:"desc"}});

    const auto=round3(rows.reduce((a,r)=>a+Number(r.automaticAmount),0)), accepted=round3(rows.reduce((a,r)=>a+Number(r.acceptedAmount),0));

    const rejected=rows.filter(r=>r.decision==="REJECTED").length, modified=rows.filter(r=>r.decision==="MODIFIED").length;

    return `🧾 CORRECTIONS — 7 أيام\n\nLignes: ${rows.length}\nAutomatique total: ${money3(auto)}\nRetenu total: ${money3(accepted)}\nRejetées: ${rejected}\nModifiées: ${modified}`;

  }



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+VENTES$/.test(cmd)) {

    const rows=await prisma.shiftSaleLine.groupBy({by:["normalizedProductName"],where:{shift:{shopId:shop.id,status:"RECORDED",recordedAt:{gte:since}}},_sum:{quantity:true},orderBy:{_sum:{quantity:"desc"}},take:10});

    return `🛒 TOP VENTES — 7 أيام\n\n${rows.length?rows.map((r,i)=>`${i+1}. ${r.normalizedProductName || "INCONNU"}: ${round3(r._sum.quantity || 0)}`).join("\n"):"Aucune vente enregistrée."}`;

  }



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+(?:CAFE|CAFÉ)$/.test(cmd)) {

    const metrics=await prisma.shiftMetric.findMany({where:{shift:{shopId:shop.id,status:"RECORDED",recordedAt:{gte:since}},metricCode:{in:["COFFEE_SOLD","COFFEE_BEANS_CONSUMED"]}}});

    const sold=round3(metrics.filter(m=>m.metricCode==="COFFEE_SOLD").reduce((a,m)=>a+Number(m.value),0));

    const beans=round3(metrics.filter(m=>m.metricCode==="COFFEE_BEANS_CONSUMED").reduce((a,m)=>a+Number(m.value),0));

    return `☕ CAFÉ — 7 أيام\n\nCafés vendus: ${sold}\nBeans consommés: ${beans} kg\nRatio global: ${beans>0?round3(sold/beans):"—"} cafés/kg`;

  }



  if (/^\/?(?:ANALYSE|ANALYTICS)\s+CHICHA$/.test(cmd)) {

    const metrics=await prisma.shiftMetric.findMany({where:{shift:{shopId:shop.id,status:"RECORDED",recordedAt:{gte:since}},metricCode:{in:["CHICHA_NORMAL","CHICHA_PERSONNEL","TOMBAC_CONSUMED"]}}});

    const normal=round3(metrics.filter(m=>m.metricCode==="CHICHA_NORMAL").reduce((a,m)=>a+Number(m.value),0));

    const personnel=round3(metrics.filter(m=>m.metricCode==="CHICHA_PERSONNEL").reduce((a,m)=>a+Number(m.value),0));

    const tombac=round3(metrics.filter(m=>m.metricCode==="TOMBAC_CONSUMED").reduce((a,m)=>a+Number(m.value),0));

    return `💨 CHICHA — 7 أيام\n\nChichas normales: ${normal}\nChichas personnel: ${personnel}\nTombac consommé: ${tombac} g\nRatio global: ${normal>0?round3(tombac/normal):"—"} g/chicha normale`;

  }



  return "أمر التحليل غير معروف. أرسل /analyse لعرض الأوامر المتاحة.";

}



function round3(v:number){ return Math.round((v + Number.EPSILON)*1000)/1000; }

function money3(v:number){ return `${v.toFixed(3)} DT`; }



function normalizeCommand(value: string) {

  let cmd = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ").toUpperCase();

  const aliases: Record<string,string> = {

    "CONFIRME DONNEE":"CONFIRME DONNEES", "CONFIRMER DONNEES":"CONFIRME DONNEES", "CONFIRMER DONNEE":"CONFIRME DONNEES",

    "CONFIRME CORRECTION":"CONFIRME CORRECTIONS", "CONFIRMER CORRECTION":"CONFIRME CORRECTIONS", "CONFIRMER CORRECTIONS":"CONFIRME CORRECTIONS",

    "ACCEPTER TOUT":"ACCEPTE TOUT", "J ACCEPTE TOUT":"ACCEPTE TOUT", "J'ACCEPTE TOUT":"ACCEPTE TOUT",

    "OUI ENREGISTRER":"OUI ENREGISTRE", "ENREGISTRE":"OUI ENREGISTRE", "ENREGISTRER":"OUI ENREGISTRE", "OUI ENREGISTRE LE SHIFT":"OUI ENREGISTRE"

  };

  return aliases[cmd] || cmd;

}



function cleanupRecetteSessions() {

  const now = Date.now();

  for (const [key, value] of recetteSessions) if (now - value.updatedAt > RECETTE_TTL) recetteSessions.delete(key);

}



function cryptoRandomId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }



export default router;
