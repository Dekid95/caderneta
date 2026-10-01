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
const CATEG_ENTRADA = ["Pagamento", "Avulso", "Vendas", "Reembolso", "Rendimentos", "Presente", "Extra"];
// nomes antigos de categorias de entrada → nomes atuais
const RENOMEAR_ENTRADA = { "Salário": "Pagamento", "Freela / Extra": "Avulso", "Outros": "Extra" };
const normalizar = d => (d && d.tipo === "entrada" && RENOMEAR_ENTRADA[d.categoria] ? { ...d, categoria: RENOMEAR_ENTRADA[d.categoria] } : d);
const MET = Object.fromEntries(METODOS.map(m => [m.id, m]));
// lançamentos antigos não têm "tipo": todos são gastos
const isIn = d => d.tipo === "entrada";
const KEY = "caderneta.gastos.v1";
const HINT_KEY = "caderneta.hint.fechado";
const BACKUP_KEY = "caderneta.ultimoBackup";   // ISO do último backup gerado
const SNOOZE_KEY = "caderneta.lembreteAdiado"; // ISO até quando o lembrete fica escondido
const LEMBRETE_DIAS = 15;
const ADIAR_DIAS = 3;

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
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.map(normalizar) : []; } catch { return []; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state.all)); return true; } catch { return false; }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const state = { all: load(), mes: monthOf(todayISO()), metodo: "pix", tipo: "entrada", editing: null, armedDelete: null, tab: "lancar" };

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
$("data").value = todayISO();

function formLabels() {
  const ent = state.tipo === "entrada";
  $("formTitle").textContent = state.editing ? (ent ? "Editar entrada" : "Editar gasto") : (ent ? "Nova entrada" : "Novo gasto");
  $("submit").textContent = state.editing ? "Salvar alteração" : (ent ? "Lançar entrada" : "Lançar gasto");
  $("valorLbl").textContent = ent ? "Valor recebido" : "Valor";
}
function setTipo(t) {
  state.tipo = t;
  const ent = t === "entrada";
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === t)));
  $("categoria").innerHTML = (ent ? CATEG_ENTRADA : CATEGORIAS).map(c => `<option>${c}</option>`).join("");
  $("metField").hidden = ent;
  $("amountBox").classList.toggle("in", ent);
  $("descricao").placeholder = ent ? "ex.: Pagamento de outubro" : "ex.: Mercado Extra";
  formLabels();
}
document.querySelector(".seg").addEventListener("click", e => {
  const b = e.target.closest("button[data-t]");
  if (b && b.dataset.t !== state.tipo) { setTipo(b.dataset.t); msg($("msg"), ""); }
});
setTipo("entrada"); // o app sempre abre em Entrada

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
  $("cancel").hidden = true;
  formLabels();
}
$("cancel").addEventListener("click", () => { resetForm(); msg($("msg"), ""); render(); });

function startEdit(doc) {
  state.editing = doc.id;
  setTipo(isIn(doc) ? "entrada" : "saida");
  cents = doc.valor; paintValor();
  if (!isIn(doc)) setMetodo(doc.metodo);
  $("categoria").value = doc.categoria;
  $("data").value = doc.data;
  $("descricao").value = doc.descricao || "";
  $("cancel").hidden = false;
  msg($("msg"), "");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("form").addEventListener("submit", e => {
  e.preventDefault();
  const m = $("msg");
  const ent = state.tipo === "entrada";
  if (!cents) return msg(m, ent ? "Digite o valor recebido." : "Digite o valor do gasto.", true);
  const data = $("data").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return msg(m, ent ? "Escolha a data em que recebeu." : "Escolha a data do gasto.", true);
  const body = {
    tipo: state.tipo, valor: cents, categoria: $("categoria").value,
    descricao: $("descricao").value.trim(), data, mes: monthOf(data),
  };
  if (!ent) body.metodo = state.metodo;
  const before = state.all.slice();
  if (state.editing) {
    const i = state.all.findIndex(d => d.id === state.editing);
    if (i >= 0) {
      const { metodo, ...rest } = state.all[i];   // entrada não guarda forma de pagamento
      state.all[i] = { ...(ent ? rest : state.all[i]), ...body };
    }
  } else {
    state.all.push({ id: newId(), ...body, criadoEm: new Date().toISOString() });
  }
  if (!persist()) { state.all = before; return msg(m, "Não foi possível salvar: o armazenamento do celular está cheio ou bloqueado.", true); }
  const verbo = state.editing ? "Alterado" : "Lançado";
  msg(m, ent ? `${verbo}: entrada de ${fmt(cents)} (${body.categoria}).` : `${verbo}: ${fmt(cents)} no ${MET[body.metodo].nome}.`);
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
  const doMes = state.all.filter(d => d.mes === cur);
  const docs = doMes.filter(d => !isIn(d));          // gastos: base de todo o relatório
  const entradas = doMes.filter(isIn);
  const prevDocs = state.all.filter(d => d.mes === prev && !isIn(d));
  const total = sum(docs);

  renderBalanco(sum(entradas), total, entradas);

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

  renderList(doMes);
  renderReminder();
}

/* ---------- balanço: entradas x gastos ---------- */
function renderBalanco(recebido, gasto, entradas) {
  const body = $("balBody");
  if (!recebido) {
    body.innerHTML = `<p class="bal-note">Lance o que recebeu no mês (pagamento, extras…) em <b>Lançar → Entrada</b> para ver quanto sobrou.</p>`;
    return;
  }
  const saldo = recebido - gasto;
  const pct = Math.round(gasto / recebido * 100);
  // agrupa as entradas por categoria quando há mais de uma
  const byC = CATEG_ENTRADA.map(c => ({ c, v: sum(entradas.filter(d => d.categoria === c)) })).filter(x => x.v);
  const detalhe = byC.length > 1 ? byC.map(x => `${x.c} ${fmt(x.v)}`).join(" · ") : "";
  body.innerHTML = `
    <div class="bal">
      <div class="bal-row in"><span>Recebido</span><span class="num">+ ${fmt(recebido)}</span></div>
      ${detalhe ? `<p class="bal-note" style="margin-top:-4px">${esc(detalhe)}</p>` : ""}
      <div class="bal-row"><span>Gasto</span><span class="num">− ${fmt(gasto)}</span></div>
      <div class="bal-row total${saldo < 0 ? " neg" : ""}"><span>${saldo < 0 ? "Faltou" : "Sobrou"}</span><span class="num">${fmt(Math.abs(saldo))}</span></div>
      <div class="meter${saldo < 0 ? " over" : ""}" aria-hidden="true"><i style="width:${Math.min(100, pct)}%"></i></div>
      <p class="bal-note">${saldo < 0
        ? `Os gastos passaram ${fmt(-saldo)} do que entrou no mês.`
        : `Você gastou ${pct}% do que recebeu.`}</p>
    </div>`;
}

/* ---------- lembrete de backup ---------- */
function getPref(k) { try { return localStorage.getItem(k); } catch { return null; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch {} }
const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const shortDate = iso => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "");

function renderReminder() {
  const last = getPref(BACKUP_KEY);
  $("lastBackup").textContent = last ? `Último backup: ${shortDate(last)}.` : "Nenhum backup feito ainda.";

  // só lembra se há gastos que ainda não estão em nenhum backup
  const pendentes = state.all.filter(d => !last || (d.criadoEm || "") > last);
  if (!pendentes.length) { $("remind").hidden = true; return; }

  // conta a partir do último backup, ou do primeiro gasto sem backup
  const desde = last || pendentes.reduce((min, d) => (d.criadoEm && d.criadoEm < min ? d.criadoEm : min), new Date().toISOString());
  const dias = daysSince(desde);
  const adiado = getPref(SNOOZE_KEY);
  const show = dias >= LEMBRETE_DIAS && !(adiado && adiado > new Date().toISOString());
  $("remind").hidden = !show;
  if (!show) return;

  const n = pendentes.length, itens = `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;
  $("remindText").innerHTML = last
    ? `Seu último backup foi há ${dias} dias.<small>${itens} ainda não ${n === 1 ? "está salvo" : "estão salvos"} fora do celular.</small>`
    : `Você ainda não fez nenhum backup.<small>Se o app for apagado, ${n === 1 ? "o lançamento feito se perde" : `os ${itens} feitos se perdem`}.</small>`;
}

$("remindBackup").addEventListener("click", () => doBackup($("msg")));
$("remindLater").addEventListener("click", () => {
  setPref(SNOOZE_KEY, new Date(Date.now() + ADIAR_DIAS * 86400000).toISOString());
  $("remind").hidden = true;
});

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
  const ds = state.all.filter(d => d.data === col.dataset.iso && !isIn(d));
  $("readout").textContent = `${dayLabel(col.dataset.iso)} · ${fmt(Number(col.dataset.v))}` + (ds.length ? ` · ${ds.length} ${ds.length === 1 ? "gasto" : "gastos"}` : "");
});

/* ---------- lista ---------- */
function renderList(docs) {
  docs = docs.slice().sort((a, b) => b.data.localeCompare(a.data) || (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  $("listTitle").textContent = "Lançamentos de " + monthName(state.mes, { month: "long" });
  const gastos = docs.filter(d => !isIn(d)), entradas = docs.filter(isIn);
  $("listTotal").textContent = [gastos.length ? "gastos " + fmt(sum(gastos)) : "", entradas.length ? "entradas " + fmt(sum(entradas)) : ""].filter(Boolean).join(" · ");
  const list = $("list");
  if (!docs.length) {
    list.innerHTML = `<div class="empty-state"><strong>Nada lançado ainda.</strong>Digite o valor, escolha como pagou e toque em “Lançar gasto”. Recebeu salário ou algum dinheiro? Escolha <b>Entrada</b> no topo do formulário. O relatório do mês se monta sozinho na aba Relatório.</div>`;
    return;
  }
  const dayTotal = items => {
    const g = sum(items.filter(d => !isIn(d))), e = sum(items.filter(isIn));
    return [g ? fmt(g) : "", e ? `<span style="color:var(--good)">+ ${fmt(e)}</span>` : ""].filter(Boolean).join(" · ");
  };
  const groups = {};
  docs.forEach(d => (groups[d.data] = groups[d.data] || []).push(d));
  list.innerHTML = Object.entries(groups).map(([day, items]) => `
    <div class="day">
      <h4><span>${dayLabel(day)}</span><span class="num">${dayTotal(items)}</span></h4>
      ${items.map(d => `
        <div class="item${state.editing === d.id ? " editing" : ""}" data-id="${esc(d.id)}" tabindex="0">
          ${isIn(d)
            ? `<span class="dot in" title="Entrada" aria-hidden="true">+</span>`
            : `<span class="dot" style="--c:var(--m-${MET[d.metodo] ? d.metodo : "vale"})"></span>`}
          <span class="desc"><b>${esc(d.descricao || d.categoria)}</b><small>${esc(d.categoria)} · ${isIn(d) ? "Entrada" : MET[d.metodo] ? MET[d.metodo].nome : esc(d.metodo)}</small></span>
          <span class="num${isIn(d) ? " in" : ""}">${isIn(d) ? "+ " : ""}${fmt(d.valor)}</span>
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
  if (!docs.length) return msg($("dataMsg"), "Não há lançamentos neste mês para exportar.", true);
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  // gastos saem negativos e entradas positivas, para a soma da coluna dar o saldo
  const rows = [["Data", "Tipo", "Descrição", "Categoria", "Pagamento", "Valor"].join(";")]
    .concat(docs.map(d => [d.data.split("-").reverse().join("/"), isIn(d) ? "Entrada" : "Gasto", q(d.descricao || ""), q(d.categoria),
      isIn(d) ? "" : MET[d.metodo] ? MET[d.metodo].nome : d.metodo,
      ((isIn(d) ? 1 : -1) * d.valor / 100).toFixed(2).replace(".", ",")].join(";")));
  const r = await shareFile(`gastos-${state.mes}.csv`, "﻿" + rows.join("\r\n"), "text/csv");
  if (r !== "cancelled") msg($("dataMsg"), "Planilha gerada. Abre no Excel, Numbers ou Google Planilhas.");
});

/* ---------- criptografia do backup (AES-GCM 256, chave derivada da senha com PBKDF2) ---------- */
const PBKDF2_ITER = 310000;
const enc = new TextEncoder(), dec = new TextDecoder();
function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

async function deriveKey(senha, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptBackup(obj, senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(senha, salt, PBKDF2_ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))));
  return {
    app: "caderneta", formato: "protegido", versao: 2, geradoEm: obj.geradoEm,
    kdf: { alg: "PBKDF2", hash: "SHA-256", iter: PBKDF2_ITER, salt: toB64(salt) },
    cifra: { alg: "AES-GCM", iv: toB64(iv) },
    dados: toB64(ct),
  };
}
async function decryptBackup(file, senha) {
  const key = await deriveKey(senha, fromB64(file.kdf.salt), file.kdf.iter);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(file.cifra.iv) }, key, fromB64(file.dados));
  return JSON.parse(dec.decode(pt));
}

/* ---------- folha de senha ---------- */
// mode "criar": pede senha + confirmação; "abrir": só a senha.
// onSubmit(senha) faz o trabalho; devolve texto de erro para manter a folha aberta, ou nada para fechar.
let pwHandler = null;
function openPwSheet({ mode, onSubmit }) {
  const criar = mode === "criar";
  $("pwTitle").textContent = criar ? "Proteger backup" : "Backup protegido";
  $("pwDesc").textContent = criar
    ? "Escolha uma senha. Ela vai ser pedida para restaurar este backup."
    : "Digite a senha usada quando este backup foi feito.";
  $("pwDesc").className = "";
  $("pwFields").hidden = false;
  $("pw2Wrap").hidden = !criar;
  $("pw1").setAttribute("autocomplete", criar ? "new-password" : "current-password");
  $("pw1").value = ""; $("pw2").value = "";
  $("pwOk").textContent = criar ? "Proteger" : "Restaurar";
  $("pwOk").disabled = false;
  msg($("pwMsg"), criar ? "Se esquecer a senha, não tem como abrir o backup. Anote num lugar seguro." : "");
  pwHandler = { criar, onSubmit };
  $("pwSheet").hidden = false;
  setTimeout(() => $("pw1").focus(), 50);
}
function closePwSheet() { $("pwSheet").hidden = true; pwHandler = null; }
$("pwCancel").addEventListener("click", closePwSheet);
$("pwSheet").addEventListener("click", e => { if (e.target === $("pwSheet")) closePwSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("pwSheet").hidden) closePwSheet(); });

$("pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!pwHandler) return;
  // segundo passo da criação: o botão já é "Salvar arquivo"
  if (pwHandler.pronto) return pwHandler.pronto();
  const s1 = $("pw1").value, s2 = $("pw2").value;
  if (pwHandler.criar) {
    if (s1.length < 6) return msg($("pwMsg"), "Use pelo menos 6 caracteres.", true);
    if (s1 !== s2) return msg($("pwMsg"), "As duas senhas não estão iguais.", true);
  } else if (!s1) return msg($("pwMsg"), "Digite a senha do backup.", true);
  $("pwOk").disabled = true;
  $("pwOk").textContent = pwHandler.criar ? "Protegendo…" : "Abrindo…";
  const err = await pwHandler.onSubmit(s1);
  if (err) {
    msg($("pwMsg"), err, true);
    $("pwOk").disabled = false;
    $("pwOk").textContent = pwHandler.criar ? "Proteger" : "Restaurar";
  }
});

/* ---------- backup ---------- */
function doBackup(msgEl) {
  if (!state.all.length) return msg(msgEl, "Ainda não há gastos para guardar.", true);
  if (!window.crypto || !crypto.subtle) return msg(msgEl, "Este navegador não consegue proteger o backup. Abra o app pelo ícone instalado.", true);
  openPwSheet({
    mode: "criar",
    onSubmit: async senha => {
      const agora = new Date().toISOString();
      let file;
      try { file = await encryptBackup({ app: "caderneta", versao: 1, geradoEm: agora, gastos: state.all }, senha); }
      catch { return "Não foi possível proteger o backup. Tente de novo."; }
      // O compartilhamento precisa partir de um toque direto, então o arquivo
      // fica pronto e o próximo toque em "Salvar arquivo" abre o menu.
      const payload = JSON.stringify(file);
      $("pwTitle").textContent = "Backup pronto";
      $("pwDesc").textContent = "Toque em Salvar arquivo e escolha onde guardar: Arquivos, iCloud Drive, Google Drive…";
      $("pwFields").hidden = true;
      msg($("pwMsg"), "");
      $("pwOk").disabled = false;
      $("pwOk").textContent = "Salvar arquivo";
      pwHandler.pronto = async () => {
        const r = await shareFile(`caderneta-backup-${todayISO()}.json`, payload, "application/json");
        if (r === "cancelled") return;
        setPref(BACKUP_KEY, agora);
        try { localStorage.removeItem(SNOOZE_KEY); } catch {}
        closePwSheet();
        msg(msgEl, "Backup protegido gerado. Guarde a senha junto com você, não junto com o arquivo.");
        renderReminder();
      };
    },
  });
}
$("backup").addEventListener("click", () => doBackup($("dataMsg")));

/* ---------- restaurar ---------- */
function mergeBackup(list) {
  if (!Array.isArray(list)) return "Esse arquivo não é um backup da Caderneta. Escolha o .json gerado em “Fazer backup”.";
  const valid = list.filter(d => d && typeof d.id === "string" && Number.isFinite(d.valor) && /^\d{4}-\d{2}-\d{2}$/.test(d.data))
    .map(d => normalizar({ ...d, mes: monthOf(d.data) }));
  if (!valid.length) return "Esse backup não tem nenhum gasto.";
  const byId = new Map(state.all.map(d => [d.id, d]));
  let novos = 0;
  valid.forEach(d => { if (!byId.has(d.id)) novos++; byId.set(d.id, d); });
  const before = state.all;
  state.all = [...byId.values()];
  if (!persist()) { state.all = before; return "Não foi possível salvar o backup no celular."; }
  render();
  msg($("dataMsg"), `Backup restaurado: ${novos} ${novos === 1 ? "lançamento novo" : "lançamentos novos"}, ${valid.length - novos} já existiam.`);
}

$("restore").addEventListener("click", () => $("restoreFile").click());
$("restoreFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  let parsed;
  try { parsed = JSON.parse(await f.text()); }
  catch { return msg($("dataMsg"), "Esse arquivo não é um backup da Caderneta. Escolha o .json gerado em “Fazer backup”.", true); }

  if (parsed && parsed.formato === "protegido") {
    if (!window.crypto || !crypto.subtle) return msg($("dataMsg"), "Este navegador não consegue abrir backups protegidos. Abra o app pelo ícone instalado.", true);
    openPwSheet({
      mode: "abrir",
      onSubmit: async senha => {
        let conteudo;
        try { conteudo = await decryptBackup(parsed, senha); }
        catch { return "Senha errada. Confira maiúsculas e minúsculas e tente de novo."; }
        const err = mergeBackup(conteudo && conteudo.gastos);
        if (err) return err;
        closePwSheet();
      },
    });
    return;
  }
  // backups antigos, de antes da proteção por senha
  const err = mergeBackup(Array.isArray(parsed) ? parsed : parsed && parsed.gastos);
  if (err) msg($("dataMsg"), err, true);
});

render();

/* ---------- offline ---------- */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
