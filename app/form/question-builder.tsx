"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Check, Copy, ExternalLink, FilePlus2, Plus, Search, SquareArrowOutUpRight, Trash2, UnlockKeyhole } from "lucide-react";

type CreatedGame = { id: string; url: string };
type CatalogGame = {
  id: string;
  creator_name: string;
  created_at: string;
  label: string;
  language: "en" | "zh";
  prompt: string;
  answers: string[];
};
const inputClass = "w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#e56b35] focus:ring-4 focus:ring-[#e56b35]/10";
const CREATOR_STORAGE_KEY = "airmouse-question-creator";
const LANGUAGE_STORAGE_KEY = "airmouse-question-language";

function subscribeToPreferences(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("airmouse-preferences-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("airmouse-preferences-change", onChange);
  };
}

function getSavedCreatorName() {
  try { return localStorage.getItem(CREATOR_STORAGE_KEY) ?? ""; } catch { return ""; }
}

function getSavedLanguage(): "en" | "zh" {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh" ? "zh" : "en"; } catch { return "en"; }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event("airmouse-preferences-change"));
  } catch { /* Browser storage is optional. */ }
}

export default function QuestionBuilder() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedGame | null>(null);
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0, text: "" });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogGames, setCatalogGames] = useState<CatalogGame[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [activeTab, setActiveTab] = useState<"catalogue" | "create">("catalogue");
  const creatorName = useSyncExternalStore(subscribeToPreferences, getSavedCreatorName, () => "");
  const language = useSyncExternalStore(subscribeToPreferences, getSavedLanguage, () => "en");
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/custom-games?q=${encodeURIComponent(catalogSearch)}`, { signal: controller.signal })
        .then(async (response) => {
          const result = await response.json() as { games?: CatalogGame[]; error?: string };
          if (!response.ok) throw new Error(result.error || "Could not load the game catalogue.");
          setCatalogGames(result.games ?? []);
          setCatalogError("");
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setCatalogError(loadError instanceof Error ? loadError.message : "Could not load the game catalogue.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setCatalogLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalogSearch, catalogRevision]);

  function updateCreatorName(value: string) {
    savePreference(CREATOR_STORAGE_KEY, value);
  }

  function updateLanguage(value: "en" | "zh") {
    savePreference(LANGUAGE_STORAGE_KEY, value);
  }

  function rememberSelection() {
    const field = promptRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    setSelection({ start, end, text: field.value.slice(start, end) });
  }

  function makeBlank() {
    const phrase = selection.text.trim();
    if (!phrase || selection.start === selection.end) return;
    const before = prompt.slice(0, selection.start);
    const after = prompt.slice(selection.end);
    const newPrompt = `${before}[[new-blank]]${after}`;
    const oldAnswers = [...answers];
    let nextIndex = 0;
    const nextAnswers: string[] = [];
    const numbered = newPrompt.replace(/\[(\d+)\]|\[\[new-blank\]\]/g, (marker) => {
      nextIndex += 1;
      nextAnswers.push(marker === "[[new-blank]]" ? phrase : oldAnswers[Number(marker.slice(1, -1)) - 1] ?? "");
      return `[${nextIndex}]`;
    });
    setPrompt(numbered);
    setAnswers(nextAnswers);
    setSelection({ start: 0, end: 0, text: "" });
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function removeBlank(index: number) {
    const target = `[${index + 1}]`;
    const rewritten = prompt.replace(target, "");
    let sequence = 0;
    const renumbered = rewritten.replace(/\[(\d+)\]/g, () => `[${++sequence}]`);
    setPrompt(renumbered);
    setAnswers(answers.filter((_, answerIndex) => answerIndex !== index));
  }

  async function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (answers.length === 0 || answers.some((answer) => !answer.trim())) {
      setError("Select at least one phrase and make sure every answer is filled in.");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setCreated(null);
    try {
      const response = await fetch("/api/custom-games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          creatorName: form.get("creatorName"), label: form.get("label"), language: form.get("language"),
          prompt, answers, instruction: form.get("instruction"),
        }),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "Could not save this question.");
      const url = new URL("/screen", window.location.origin);
      url.searchParams.set("game", result.id);
      setCreated({ id: result.id, url: url.toString() });
      setCatalogLoading(true);
      setCatalogRevision((revision) => revision + 1);
      setPrompt("");
      setAnswers([]);
      formElement.reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save this question.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    window.location.reload();
  }

  return (
    <>
      <div role="tablist" aria-label="Custom game tools" className="mb-5 grid grid-cols-2 rounded-2xl bg-[#edf4ef] p-1">
        <button id="catalogue-tab" type="button" role="tab" aria-selected={activeTab === "catalogue"} aria-controls="catalogue-panel" tabIndex={activeTab === "catalogue" ? 0 : -1} onClick={() => setActiveTab("catalogue")} onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setActiveTab("create"); document.getElementById("create-tab")?.focus(); }
        }} className={`min-h-12 rounded-xl px-3 text-sm font-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24794d] ${activeTab === "catalogue" ? "bg-white text-[#17211c] shadow-sm" : "text-[#66736c] hover:bg-white/60"}`}>Game catalogue</button>
        <button id="create-tab" type="button" role="tab" aria-selected={activeTab === "create"} aria-controls="create-panel" tabIndex={activeTab === "create" ? 0 : -1} onClick={() => setActiveTab("create")} onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setActiveTab("catalogue"); document.getElementById("catalogue-tab")?.focus(); }
        }} className={`min-h-12 rounded-xl px-3 text-sm font-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24794d] ${activeTab === "create" ? "bg-white text-[#17211c] shadow-sm" : "text-[#66736c] hover:bg-white/60"}`}>Create a game</button>
      </div>

      <div id="catalogue-panel" role="tabpanel" aria-labelledby="catalogue-tab" hidden={activeTab !== "catalogue"}>
      <section className="mb-8 rounded-2xl border border-black/10 bg-[#f7faf7] p-4 sm:p-6" aria-labelledby="catalogue-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="catalogue-title" className="text-xl font-black">Game catalogue</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#66736c]">Search existing games by name, creator, or passage before making another one.</p>
          </div>
          <button type="button" onClick={() => setActiveTab("create")} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#24794d] px-4 text-sm font-bold text-white hover:bg-[#1c633e]"><Plus className="size-4" /> Create a new game</button>
        </div>
        <label className="mt-5 flex min-h-12 items-center gap-3 rounded-xl border border-black/15 bg-white px-4 focus-within:border-[#e56b35] focus-within:ring-4 focus-within:ring-[#e56b35]/10">
          <Search className="size-4 shrink-0 text-[#66736c]" aria-hidden="true" />
          <span className="sr-only">Search game catalogue</span>
          <input type="search" value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setCatalogLoading(true); setCatalogError(""); }} maxLength={120} className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm outline-none" placeholder="Search game name, creator, passage, or answer" />
        </label>
        {catalogError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{catalogError}</p>}
        {catalogLoading && <p role="status" className="mt-4 text-sm text-[#66736c]">Searching the catalogue…</p>}
        {!catalogLoading && !catalogError && catalogGames.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-black/15 p-4 text-sm text-[#66736c]">{catalogSearch ? "No matching games. You can create it below." : "No custom games yet. Add the first one below."}</p>}
        {catalogGames.length > 0 && <ul className="mt-4 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
          {catalogGames.map((game) => <li key={game.id} className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="break-words font-black">{game.label}</h3>
                <p className="mt-1 text-xs text-[#66736c]">By {game.creator_name} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(game.created_at))} · {game.language === "zh" ? "中文" : "English"} · {game.answers.length} {game.answers.length === 1 ? "blank" : "blanks"}</p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#52645a]">{game.prompt.replace(/\[(\d+)\]/g, "_____ ").slice(0, 240)}{game.prompt.length > 240 ? "…" : ""}</p>
              </div>
              <a href={`/screen?game=${encodeURIComponent(game.id)}`} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#24794d]/25 px-3 text-sm font-bold text-[#1c633e] hover:bg-[#e4f4eb]"><SquareArrowOutUpRight className="size-4" /> Open game</a>
            </div>
          </li>)}
        </ul>}
        {!catalogLoading && catalogGames.length === 100 && <p className="mt-3 text-xs text-[#66736c]">Showing up to 100 results. Add more words to narrow your search.</p>}
      </section>
      </div>

      <div id="create-panel" role="tabpanel" aria-labelledby="create-tab" hidden={activeTab !== "create"}>
      <form onSubmit={createGame} className="space-y-5 sm:space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
          <label className="block space-y-2 text-sm font-bold"><span>Your name</span><input name="creatorName" value={creatorName} onChange={(event) => updateCreatorName(event.target.value)} required maxLength={80} autoComplete="name" className={inputClass} placeholder="Who created this?" /></label>
          <label className="block space-y-2 text-sm font-bold"><span>Game name</span><input name="label" required maxLength={80} className={inputClass} placeholder="e.g. Team retreat round 1" /></label>
        </div>
        <label className="block space-y-2 text-sm font-bold"><span>Language</span>
          <select name="language" className={inputClass} value={language} onChange={(event) => updateLanguage(event.target.value as "en" | "zh")}><option value="en">English</option><option value="zh">ä¸­æ–‡</option></select>
        </label>

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-black">Question or passage</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#66736c]">Paste or type the full passage, select an answer phrase, then turn it into a blank. On a phone, touch and hold the phrase to select it.</p>
          </div>
          <textarea
            ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)}
            onSelect={rememberSelection} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onTouchEnd={rememberSelection}
            maxLength={8000} rows={5} className={`${inputClass} min-h-48 resize-y leading-relaxed sm:min-h-64`}
            placeholder="Paste the passage here. Select a phrase like 'shared memory' to create the first blank."
            aria-label="Question or passage"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={makeBlank} disabled={!selection.text.trim()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e4f4eb] px-4 text-sm font-black text-[#1c633e] transition hover:bg-[#d2ebdc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24794d] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              <Plus className="size-4" /> Turn selected text into blank
            </button>
            <span aria-live="polite" className="text-sm text-[#66736c]">{answers.length} {answers.length === 1 ? "blank" : "blanks"} added</span>
          </div>
        </section>

        {answers.length > 0 && <section className="space-y-3" aria-labelledby="answers-title">
          <div><h2 id="answers-title" className="text-base font-black">Answer phrases</h2><p className="mt-1 text-sm text-[#66736c]">Edit the phrases here. The numbers match the blanks in your passage.</p></div>
          <ol className="space-y-3">
            {answers.map((answer, index) => <li key={index} className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-2xl border border-black/10 bg-[#f7faf7] p-2 sm:flex sm:gap-3 sm:p-3">
              <span className="row-start-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white font-mono text-sm font-black text-[#24794d] sm:row-auto">{index + 1}</span>
              <label className="sr-only" htmlFor={`answer-${index}`}>Answer phrase {index + 1}</label>
              <input id={`answer-${index}`} value={answer} onChange={(event) => setAnswers(answers.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} maxLength={300} className="col-span-3 row-start-2 h-11 min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#e56b35] focus:ring-4 focus:ring-[#e56b35]/10 sm:col-span-1 sm:row-auto sm:flex-1" placeholder={`Answer phrase ${index + 1}`} />
              <button type="button" onClick={() => removeBlank(index)} aria-label={`Remove blank ${index + 1}`} className="col-start-3 row-start-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-[#9e3b2e] hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-[#9e3b2e] sm:col-auto sm:row-auto"><Trash2 className="size-4" /></button>
            </li>)}
          </ol>
        </section>}
        {answers.length === 0 && <p className="rounded-xl bg-[#f4f7f4] p-4 text-sm text-[#52645a]">When you select text and add a blank, its answer phrase will appear here.</p>}

        <label className="block space-y-2 text-sm font-bold"><span>Player instruction <span className="font-normal text-[#66736c]">(optional)</span></span><input name="instruction" maxLength={240} className={inputClass} placeholder="Drag each phrase into its place." /></label>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        {created && <div role="status" className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center gap-2 font-bold text-emerald-900"><Check className="size-5" /> Saved to Supabase. Game UUID: <span className="font-mono text-sm">{created.id}</span></div>
          <p className="break-all text-sm text-emerald-900/75">{created.url}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={copyLink} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-bold text-white hover:bg-emerald-900">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy game link"}</button>
            <a href={created.url} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-800/20 px-4 text-sm font-bold text-emerald-900 hover:bg-emerald-100"><ExternalLink className="size-4" /> Open host screen</a>
          </div>
        </div>}
        <button type="submit" disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#24794d] px-5 font-black text-white transition hover:bg-[#1c633e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24794d] disabled:cursor-wait disabled:opacity-55">
          <FilePlus2 className="size-4" /> {busy ? "Saving questionâ€¦" : "Save question and create game link"}
        </button>
      </form>

      <aside className="mt-8 rounded-2xl bg-[#f4f7f4] p-5 text-sm leading-relaxed text-[#52645a]">
        <h2 className="font-black text-[#17211c]">Supabase catalogue</h2>
        <p className="mt-2">Each question is saved in Supabase with its UUID, creator, date, passage, answers, and language. Share access to the Supabase project with collaborators who need to manage the catalogue.</p>
      </aside>
      <div className="mt-5 flex justify-end"><button type="button" onClick={logout} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[#66736c] hover:bg-white"><UnlockKeyhole className="size-4" /> Lock admin page</button></div>
      </div>
    </>
  );
}
