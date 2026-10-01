"use strict";

const METODOS = [
  { id: "credito", nome: "Crédito" },
  { id: "debito", nome: "Débito" },
  { id: "pix", nome: "Pix" },
  { id: "dinheiro", nome: "Dinheiro" },
  { id: "boleto", nome: "Boleto" },
  { id: "vale", nome: "VR/VA" },
];
const CATEGORIAS = ["Mercado", "Alimentação", "Transporte", "Moradia", "Contas", "Saúde", "Lazer", "Compras", "Educação", "Assinaturas", "Outros"];
const MET = Object.fromEntries(METODOS.map(m => [m.id, m]));
const KEY = "caderneta.gastos.v1";
const HINT_KEY = "caderneta.hint.fechado";

/* ---------- helpers ---------- */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = c => brl.format((c || 0) / 100).replace(/ /g, " ");
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthOf = iso => iso.slice(0, 7);
const shiftMonth = (ym, k) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysIn = ym => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const monthName = (ym, opts = { month: "short", year: "numeric" }) => { const [y, m] = ym.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", opts).format(new Date(y, m - 1, 1)).replace(" de ", " "); };
const dayLabel = iso => { const [y, m, d] = iso.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "short" }).format(new Date(y, m - 1, d)); };
const sum = arr => arr.reduce((a, d) => a + (d.valor || 0), 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- storage (só no aparelho) ---------- */
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state.all)); return true; } catch { return false; }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const state = { all: load(), mes: monthOf(todayISO()), metodo: "pix", editing: null, armedDelete: null, tab: "lancar" };

/* ---------- tabs ---------- */
function setTab(t) {
  state.tab = t;
  ["lancar", "relatorio"].forEach(k => {
    $("view-" + k).hidden = k !== t;
    $("tab-" + k).setAttribute("aria-selected", String(k === t));
  });
  window.scrollTo(0, 0);
}
$("tab-lancar").addEventListener("click", () => setTab("lancar"));
$("tab-relatorio").addEventListener("click", () => setTab("relatorio"));

/* ---------- install hint (iPhone, fora do app instalado) ---------- */
(function () {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  let closed = false;
  try { closed = localStorage.getItem(HINT_KEY) === "1"; } catch {}
  $("installHint").hidden = !(ios && !standalone && !closed);
  // No Chrome o botão de compartilhar fica na barra de endereço, no alto
  if (/CriOS/.test(navigator.userAgent)) $("hintWhere").textContent = "(na barra de endereço, no alto)";
  $("hideHint").addEventListener("click", () => { $("installHint").hidden = true; try { localStorage.setItem(HINT_KEY, "1"); } catch {} });
})();

/* ---------- form ---------- */
$("methods").innerHTML = METODOS.map(m =>
  `<button type="button" data-m="${m.id}" aria-pressed="false"><span class="dot" style="--c:var(--m-${m.id})"></span>${m.nome}</button>`).join("");
$("categoria").innerHTML = CATEGORIAS.map(c => `<option>${c}</option>`).join("");
$("data").value = todayISO();

function setMetodo(id) {
  state.metodo = id;
  document.querySelectorAll("#methods button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === id)));
}
setMetodo("pix");
$("methods").addEventListener("click", e => { const b = e.target.closest("button[data-m]"); if (b) setMetodo(b.dataset.m); });

let cents = 0;
function paintValor() { $("valor").value = cents ? (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
$("valor").addEventListener("input", e => {
  cents = Number(e.target.value.replace(/\D/g, "").slice(0, 10) || 0);
  paintValor();
});

function msg(el, text, err) { el.textContent = text; el.className = "msg" + (err ? " err" : ""); }

function resetForm() {
  state.editing = null; cents = 0; paintValor();
  $("descricao").value = "";
  $("formTitle").textContent = "Novo gasto";
  $("submit").textContent = "Lançar gasto";
  $("cancel").hidden = true;
}
$("cancel").addEventListener("click", () => { resetForm(); msg($("msg"), ""); render(); });

function startEdit(doc) {
  state.editing = doc.id;
  cents = doc.valor; paintValor();
  setMetodo(doc.metodo);
  $("categoria").value = doc.categoria;
  $("data").value = doc.data;
  $("descricao").value = doc.descricao || "";
  $("formTitle").textContent = "Editar gasto";
  $("submit").textContent = "Salvar alteração";
  $("cancel").hidden = false;
  msg($("msg"), "");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("form").addEventListener("submit", e => {
  e.preventDefault();
  const m = $("msg");
  if (!cents) return msg(m, "Digite o valor do gasto.", true);
  const data = $("data").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return msg(m, "Escolha a data do gasto.", true);
  const body = {
    valor: cents, metodo: state.metodo, categoria: $("categoria").value,
    descricao: $("descricao").value.trim(), data, mes: monthOf(data),
  };
  const before = state.all.slice();
  if (state.editing) {
    const i = state.all.findIndex(d => d.id === state.editing);
    if (i >= 0) state.all[i] = { ...state.all[i], ...body };
  } else {
    state.all.push({ id: newId(), ...body, criadoEm: new Date().toISOString() });
  }
  if (!persist()) { state.all = before; return msg(m, "Não foi possível salvar: o armazenamento do celular está cheio ou bloqueado.", true); }
  msg(m, `${state.editing ? "Alterado" : "Lançado"}: ${fmt(cents)} no ${MET[body.metodo].nome}.`);
  resetForm();
  $("data").value = data;
  state.mes = body.mes;
  document.activeElement && document.activeElement.blur();
  render();
});

/* ---------- month nav ---------- */
$("prev").addEventListener("click", () => { state.mes = shiftMonth(state.mes, -1); state.armedDelete = null; render(); });
$("next").addEventListener("click", () => { state.mes = shiftMonth(state.mes, 1); state.armedDelete = null; render(); });

/* ---------- render ---------- */
function render() {
  const cur = state.mes, prev = shiftMonth(cur, -1), today = todayISO();
  const isCurrent = cur === monthOf(today);
  $("monthLabel").textContent = monthName(cur);
  $("next").disabled = cur >= monthOf(today);
  const docs = state.all.filter(d => d.mes === cur);
  const prevDocs = state.all.filter(d => d.mes === prev);
  const total = sum(docs);

  // resumo
  $("totLbl").textContent = isCurrent ? "Gasto até agora" : "Total do mês";
  $("total").textContent = fmt(total);
  $("count").textContent = docs.length;
  const elapsed = isCurrent ? Number(today.slice(8)) : daysIn(cur);
  $("avg").textContent = docs.length ? fmt(Math.round(total / elapsed)) : "—";

  // no mês corrente compara com o mesmo período do mês anterior
  const cutoff = isCurrent ? Number(today.slice(8)) : 31;
  const prevTotal = sum(prevDocs.filter(d => Number(d.data.slice(8)) <= cutoff));
  const prevName = monthName(prev, { month: "long" });
  $("cmpLbl").textContent = isCurrent ? `Comparado ao início de ${prevName}` : `Comparado a ${prevName}`;
  const cmp = $("cmp");
  if (!prevTotal) { cmp.textContent = "—"; cmp.className = "v delta"; $("cmpSub").textContent = "sem lançamentos para comparar"; }
  else {
    const diff = total - prevTotal, pct = Math.round(diff / prevTotal * 100);
    cmp.textContent = (diff > 0 ? "+" : diff < 0 ? "−" : "") + Math.abs(pct) + "%";
    cmp.className = "v delta " + (diff > 0 ? "up" : diff < 0 ? "down" : "");
    $("cmpSub").textContent = `${fmt(prevTotal)} ${isCurrent ? "até o dia " + cutoff : "no mês"}`;
  }

  // por método
  const byM = METODOS.map(m => { const ds = docs.filter(d => d.metodo === m.id); return { ...m, v: sum(ds), n: ds.length }; });
  const stack = $("stack");
  stack.classList.toggle("empty", !total);
  stack.innerHTML = total ? byM.filter(m => m.v).map(m => `<div style="--c:var(--m-${m.id});flex-basis:${m.v / total * 100}%"></div>`).join("") : "";
  $("methodRows").innerHTML = byM.slice().sort((a, b) => b.v - a.v).map(m => `
    <tr class="${m.v ? "" : "zero"}">
      <td><span class="dot" style="--c:var(--m-${m.id})"></span>${m.nome}</td>
      <td class="r q">${m.n ? m.n + (m.n === 1 ? " gasto" : " gastos") : ""}</td>
      <td class="r q num">${total && m.v ? Math.round(m.v / total * 100) + "%" : ""}</td>
      <td class="r num">${fmt(m.v)}</td>
    </tr>`).join("");
  const cred = byM.find(m => m.id === "credito").v;
  $("cardNote").textContent = cred ? `${fmt(cred)} na fatura do cartão` : "";

  // por categoria
  const byC = CATEGORIAS.map(c => ({ c, v: sum(docs.filter(d => d.categoria === c)) })).filter(x => x.v).sort((a, b) => b.v - a.v);
  const maxC = byC.length ? byC[0].v : 1;
  $("cats").innerHTML = byC.length ? byC.map(x => `
    <div class="cat"><span>${x.c}</span><div class="track"><div class="fill" style="width:${x.v / maxC * 100}%"></div></div><span class="num">${fmt(x.v)}</span></div>`).join("")
    : `<p style="margin:0;color:var(--ink-3)">Nenhum gasto em ${monthName(cur, { month: "long" })}.</p>`;

  // dia a dia
  const n = daysIn(cur), perDay = Array(n).fill(0);
  docs.forEach(d => { perDay[Number(d.data.slice(8)) - 1] += d.valor; });
  const maxD = Math.max(...perDay, 1);
  const step = niceStep(maxD), top = Math.max(step, Math.ceil(maxD / step) * step);
  const lines = [];
  for (let v = step; v <= top; v += step) lines.push(`<div class="gridline" style="bottom:${v / top * 100}%"><span>${fmtShort(v)}</span></div>`);
  $("plot").innerHTML = lines.join("") + perDay.map((v, i) =>
    `<div class="col" data-iso="${cur}-${pad(i + 1)}" data-v="${v}"><i style="height:${v / top * 100}%"></i></div>`).join("");
  $("axis").innerHTML = `<span>1</span><span>${Math.ceil(n / 2)}</span><span>${n}</span>`;
  $("readout").textContent = "Toque numa barra para ver o dia.";

  // dados
  $("storeInfo").textContent = `Os gastos ficam guardados só neste celular (${state.all.length} ${state.all.length === 1 ? "lançamento" : "lançamentos"} no total).`;

  renderList(docs);
}

function niceStep(max) {
  const raw = max / 3, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}
function fmtShort(c) { const r = c / 100; return r >= 1000 ? "R$ " + (r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : "R$ " + Math.round(r); }

$("plot").addEventListener("click", e => {
  const col = e.target.closest(".col");
  document.querySelectorAll("#plot .col.on").forEach(c => c.classList.remove("on"));
  if (!col) return;
  col.classList.add("on");
  const ds = state.all.filter(d => d.data === col.dataset.iso);
  $("readout").textContent = `${dayLabel(col.dataset.iso)} · ${fmt(Number(col.dataset.v))}` + (ds.length ? ` · ${ds.length} ${ds.length === 1 ? "gasto" : "gastos"}` : "");
});

/* ---------- lista ---------- */
function renderList(docs) {
  docs = docs.slice().sort((a, b) => b.data.localeCompare(a.data) || (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  $("listTitle").textContent = "Lançamentos de " + monthName(state.mes, { month: "long" });
  $("listTotal").textContent = docs.length ? fmt(sum(docs)) : "";
  const list = $("list");
  if (!docs.length) {
    list.innerHTML = `<div class="empty-state"><strong>Nada lançado ainda.</strong>Digite o valor, escolha como pagou e toque em “Lançar gasto”. O relatório do mês se monta sozinho na aba Relatório.</div>`;
    return;
  }
  const groups = {};
  docs.forEach(d => (groups[d.data] = groups[d.data] || []).push(d));
  list.innerHTML = Object.entries(groups).map(([day, items]) => `
    <div class="day">
      <h4><span>${dayLabel(day)}</span><span class="num">${fmt(sum(items))}</span></h4>
      ${items.map(d => `
        <div class="item${state.editing === d.id ? " editing" : ""}" data-id="${esc(d.id)}" tabindex="0">
          <span class="dot" style="--c:var(--m-${MET[d.metodo] ? d.metodo : "vale"})"></span>
          <span class="desc"><b>${esc(d.descricao || d.categoria)}</b><small>${esc(d.categoria)} · ${MET[d.metodo] ? MET[d.metodo].nome : esc(d.metodo)}</small></span>
          <span class="num">${fmt(d.valor)}</span>
          <button type="button" class="del${state.armedDelete === d.id ? " confirm" : ""}" data-del="${esc(d.id)}" aria-label="Apagar">${state.armedDelete === d.id ? "Apagar" : "×"}</button>
        </div>`).join("")}
    </div>`).join("");
}

$("list").addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const id = del.dataset.del;
    if (state.armedDelete !== id) { state.armedDelete = id; render(); return; }
    state.armedDelete = null;
    const before = state.all.slice();
    state.all = state.all.filter(d => d.id !== id);
    if (!persist()) state.all = before;
    if (state.editing === id) resetForm();
    render();
    return;
  }
  const item = e.target.closest(".item");
  if (item) {
    state.armedDelete = null;
    const d = state.all.find(x => x.id === item.dataset.id);
    if (d) startEdit(d);
  }
});
$("list").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("item")) e.target.click(); });

/* ---------- exportar / backup ---------- */
async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

$("exportCsv").addEventListener("click", async () => {
  const docs = state.all.filter(d => d.mes === state.mes).sort((a, b) => a.data.localeCompare(b.data));
  if (!docs.length) return msg($("dataMsg"), "Não há gastos neste mês para exportar.", true);
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [["Data", "Descrição", "Categoria", "Pagamento", "Valor"].join(";")]
    .concat(docs.map(d => [d.data.split("-").reverse().join("/"), q(d.descricao || ""), q(d.categoria), MET[d.metodo] ? MET[d.metodo].nome : d.metodo,
      (d.valor / 100).toFixed(2).replace(".", ",")].join(";")));
  const r = await shareFile(`gastos-${state.mes}.csv`, "﻿" + rows.join("\r\n"), "text/csv");
  if (r !== "cancelled") msg($("dataMsg"), "Planilha gerada. Abre no Excel, Numbers ou Google Planilhas.");
});

$("backup").addEventListener("click", async () => {
  if (!state.all.length) return msg($("dataMsg"), "Ainda não há gastos para guardar.", true);
  const payload = JSON.stringify({ app: "caderneta", versao: 1, geradoEm: new Date().toISOString(), gastos: state.all });
  const r = await shareFile(`caderneta-backup-${todayISO()}.json`, payload, "application/json");
  if (r !== "cancelled") msg($("dataMsg"), "Backup gerado. Salve em Arquivos, iCloud ou mande para você mesmo.");
});

$("restore").addEventListener("click", () => $("restoreFile").click());
$("restoreFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const parsed = JSON.parse(await f.text());
    const list = Array.isArray(parsed) ? parsed : parsed.gastos;
    if (!Array.isArray(list)) throw new Error();
    const valid = list.filter(d => d && typeof d.id === "string" && Number.isFinite(d.valor) && /^\d{4}-\d{2}-\d{2}$/.test(d.data))
      .map(d => ({ ...d, mes: monthOf(d.data) }));
    if (!valid.length) throw new Error();
    const byId = new Map(state.all.map(d => [d.id, d]));
    let novos = 0;
    valid.forEach(d => { if (!byId.has(d.id)) novos++; byId.set(d.id, d); });
    const before = state.all;
    state.all = [...byId.values()];
    if (!persist()) { state.all = before; return msg($("dataMsg"), "Não foi possível salvar o backup no celular.", true); }
    render();
    msg($("dataMsg"), `Backup restaurado: ${novos} ${novos === 1 ? "lançamento novo" : "lançamentos novos"}, ${valid.length - novos} já existiam.`);
  } catch {
    msg($("dataMsg"), "Esse arquivo não é um backup da Caderneta. Escolha o .json gerado em “Fazer backup”.", true);
  }
});

render();

/* ---------- offline ---------- */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
