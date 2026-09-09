# Broker Synchronisation and Order Execution: Feasibility Research

## 2026-09-02

This document reports factual findings about Brazilian broker data synchronisation and programmatic order execution capabilities, drawn from primary sources. It does not recommend, only reports what is possible today.

---

## 1. Open Finance Brasil—Investments Scope

**Status:** Phase 4 (Open Investment) active in 2026.

### Scope Summary

Open Finance Brasil's Phase 4 (Open Investment) covers:

- **Renda Fixa Bancária** (Banking Fixed Income)
- **Renda Fixa Crédito** (Credit Fixed Income)
- **Renda Variável** (Variable Income)
- **Títulos do Tesouro Direto** (Treasury Direct securities)
- **Fundos de Investimento** (Investment Funds)

**Source:** [Open Finance Brasil Developer Area—Investimentos APIs](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/103284839/APIs+-+Investimentos) (v1.0.1 current as of February 2026).

### Variable Income (Renda Variável)—Detailed Scope

Within **Renda Variável**, the API exposes:

- **Equities** (stocks, index funds)
- **Positions** (current holdings with quantity and average cost)
- **Transactions/Movements** (historical fills from the last 12 months)
- **Corporate events** (dividends, splits, etc.)

**Version:** Renda Variável API v1.3.0 (current specification).

**Source:** [Open Finance Brasil—Renda Variável Informações Gerais, v1.0.0-rc3.0](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/144900298/Informa%C3%A7%C3%B5es+Gerais+-+Renda+Vari%C3%A1vel+-+v1.0.0-rc3.0).

### Derivatives and Stock Options

**Finding:** Stock options (opções) and other derivatives are **not included** in the Phase 4 Open Finance Brasil Renda Variável scope. The current specification covers spot equities, ETFs, and index funds only.

**Evidence:**

- Derivatives and options are treated under separate, not-yet-launched market segments.
- XP documentation mentions "o primeiro derivativo de opções para Fundos Imobiliários" (the first options derivative for real estate funds) as a recent innovation, not part of Open Finance standardization.
- Open Finance Brasil developer documentation explicitly lists products as "fixed income, credit fixed income, variable income, treasury, and funds"—derivatives are absent.

**Source:** [Open Finance Brasil—Data Scope Dictionary](https://openfinancebrasil.org.br/escopo-de-dados-dicionario-2/).

### Regulatory Phase-In

By end of 2026, financial institutions must implement an information quality policy for Open Finance data sharing, per CVM directives.

**Source:** [Finsiders Brasil—Open Finance Growth Report, February 2026](https://finsidersbrasil.com.br/economia-open/cresce-compartilhamento-de-dados-de-investimentos-no-open-finance/).

---

## 2. Pluggy—Investments API

**Status:** Payment Transaction Initiator (ITP) authorized by Banco Central. Strategic partnership with B3 announced (August 2026).

### Coverage

Pluggy's Open Finance Connectors expose:

- **Product:** INVESTMENTS & INVESTMENT_TRANSACTIONS & BROKERAGE_NOTES
- **Broker Coverage:** Varies by institution type. Not every connector supports every product; coverage depends on whether the partner is a full bank, broker, card issuer, or digital wallet.
- **Current Availability:** Limited to brokers that have integrated with Pluggy's platform via Open Finance Brasil APIs.

**Limitation:** Pluggy documentation explicitly states "Product coverage varies per institution. Always verify which products a specific connector exposes before building your integration."

**Source:** [Pluggy—Open Finance Regulated Connectors Documentation](https://docs.pluggy.ai/docs/open-finance-regulated).

### Specific Broker List for Investments

Pluggy does not publish a public list of supported brokers for investments. This information is available only to API consumers and requires contacting Pluggy's sales team.

**Source:** Pluggy sales docs (access restricted); [Pluggy Products—Open Finance](https://www.pluggy.ai/produtos/open-finance).

### Pricing

- **Model:** Not per-item; quoted per account or API call volume.
- **Entry:** Basic Plan starts ~R$2,500/month; custom quotes for investments data.
- **Details:** Contact sales; no per-transaction pricing published.

**Source:** [Pluggy Pricing Page](https://www.pluggy.ai/en/pricing).

---

## 3. B3 Área do Investidor (ex-CEI)

**Status:** Operational replacement for CEI (Canal Eletrônico do Investidor), launched progressively in 2024–2025.

### Manual Data Export

**Available for retail individual investors:**

- PDF or Excel export from all web interface screens
- Query filters for date ranges and asset classes
- Data current as of D-1 (previous business day)

**Data types accessible:**

- **Posição** (Position): Current holdings by asset, quantity, average cost
- **Movimentação** (Movement): Transaction history (buys, sells, corporate events)
- **Negociação de ativos** (Asset trading): Listed trades only (not derivatives)

**Source:** [B3—Área do Investidor](https://www.b3.com.br/pt_br/produtos-e-servicos/central-depositaria/canal-com-investidores/area-do-investidor/).

### API Access (B2B Only)

**For fintech/institutional integration:**

- **Available endpoints:** 12 REST APIs for institutional clients only
- **Data lag:** All data D-1 (previous business day)
- **Authentication:** OAuth2 via B3 ID
- **Access:** Direct API access **not available to retail individuals**; only to fintechs and institutional partners

**Returned data includes:**

- Account balance and position
- Movement history
- Corporate events
- Public offering participation
- Investor authorisation status

**Source:** [B3 For Developers—Área do Investidor APIs](https://developers.b3.com.br/apis/api-area-do-investidor); [B3—API Integrations Documentation](https://www.b3.com.br/pt_br/produtos-e-servicos/central-depositaria/canal-com-investidores/integracoes-da-area-do-investidor-apis/).

**Licensing/Terms:** Automated access requires institutional partnership agreement with B3. Retail users cannot obtain API credentials directly.

---

## 4. Brokerage Note (Nota de Corretagem) Standard

### SINACOR Standard

**Definition:** Sistema Integrado de Administração de Corretoras. The Brazilian market standard for brokerage note interchange, used by ~95% of brokers.

**Format:** PDF or text file with fixed-width fields.

**Typical contents:**

- Trade dates and settlement
- Instrument ticker, quantity, executed price per fill
- Fees: corretagem (brokerage commission), emolumentos (exchange fee), registro B3 (B3 registration fee)
- Tax: IRRF (income tax withheld) on day-trading gains
- Net debit/credit summary
- Account and broker registration

**Layout version:** SINACOR v23.3.0 (current as of 2026).

**Source:** [B3—SINACOR Version Letter, v23.3.0](https://clientes.b3.com.br/c/document_library/get_file?groupId=20119&uuid=ebe49ecf-a273-a747-a58c-94f2407fac04); [Mycapital—SINACOR Format Guide](https://mycapital.movidesk.com/kb/pt-br/article/121298/como-e-uma-nota-de-corretagem-no-padrao-sinacor-e-onde-posso-con).

### Open-Source Parsers

**Python:**

- **CorrePy** (Python library): Parses SINACOR notes and returns JSON. Supports a subset of brokers.
  - Source: https://github.com/thiagosalvatore/correpy
  - Status: Active maintenance.
  - Known issue: Inter's format deviates from standard; parsing fails for Inter notes.

- **COIR** (Excel-based): Extracts SINACOR notes into spreadsheet format. Supports spot, futures, and derivatives.
  - Source: https://marcelopcf.github.io/COIR/
  - Status: Mature; Windows-only.

- **py_financas** (Python package): Broader Brazilian financial data abstraction, includes SINACOR parsing.
  - Source: https://github.com/jfrfonseca/py_financas
  - Status: Educational/experimental.

**JavaScript/TypeScript:**

- **parser-de-notas-de-corretagem**: Parses SINACOR PDFs from Rico, Clear, and Inter brokers.
  - Source: https://github.com/planetsLightningArrester/parser-de-notas-de-corretagem
  - Status: Maintained; covers 3 brokers.

**SINACOR-PARSER (language-agnostic):**

- Free, offline PDF parser for SINACOR standard notes.
  - Source: https://github.com/vcolella/SINACOR-PARSER
  - Status: Under development; disclaimer: "may generate wrong results; developers not responsible for reliability."

### Broker-Specific Reliability

| Broker    | Parser Status | Notes                                                                                               |
| --------- | ------------- | --------------------------------------------------------------------------------------------------- |
| **XP**    | ✓ Working     | Standard SINACOR compliance; CorrePy and custom parsers functional                                  |
| **Rico**  | ✓ Working     | Some deviation from strict SINACOR; parser-de-notas-de-corretagem covers                            |
| **Clear** | ⚠ Partial     | Limited parser support; uses XP Inc infrastructure (same legal entity); Clear-specific parsers rare |
| **Inter** | ✗ Problematic | Declares SINACOR compliance but format deviates; CorrePy fails; requires custom parsing             |
| **BTG**   | ⚠ Unknown     | No public parser found; BTG notes likely SINACOR-adjacent; may need custom handling                 |

**Reliability summary:** XP and Rico notes parse reliably with public tools. Inter requires custom development. BTG and Clear lack public parser coverage.

**Source:** [CorrePy Issue #6—Inter Support](https://github.com/thiagosalvatore/correpy/issues/6); [parser-de-notas-de-corretagem](https://github.com/planetsLightningArrester/parser-de-notas-de-corretagem).

---

## 5. Order Execution for Retail Accounts

### Trading Platforms Available to Retail

#### MetaTrader 5 (MT5) with B3 Gateway

**Supported by:**

- Rico Corretora (MT5 with Hedge and Net account types)
- XP Investimentos (Hedge and Net accounts)
- Genial Investimentos (Hedge accounts)
- Modal (DMA4 connectivity; availability may vary)
- BTG Pactual (Hedge account option)
- Clear (previously offered; current status unclear)

**Characteristics:**

- Desktop application (Windows, macOS, Linux)
- Order submission: Buy/sell equities, ETFs, options, and futures on B3 via MetaTrader 5 BM&FBOVESPA Gateway.
- MQL5 scripting for algorithmic strategies.
- No built-in REST API; requires wrapper (e.g., MT5SE project on GitHub).

**Costs:** Brokerage fee varies by broker (XP ~0.2%, Clear zero, Rico varies). Brokerage maintains custody of account.

**Regulatory requirement:** Automated systems' source code must be available for CVM inspection in uncompiled format (CVM Resolução nº 21).

**Source:** [MetaQuotes/MetaTrader News—Rico Launches MT5 on B3](https://www.metaquotes.net/en/company/news/4670); [MQL5 Forum—MT5 on B3](https://www.mql5.com/pt/forum/349819).

#### Nelogica Profit + ProfitDLL

**What it is:** Native Windows DLL providing programmatic access to order placement, market data, and trade history.

**Supported exchanges:** BM&F (futures) and Bovespa (equities, options).

**Key features:**

- Complete order routing: send, track, modify, cancel, zero position.
- Latency <10 ms; 5+ TB historical data available.
- Languages: C++, C#, Python, Delphi.
- Market leader in algorithmic trading in Brazil (Algotools platform).

**Access:** Requires Nelogica account and Profit terminal subscription; ProfitDLL licensing separate.

**Costs:** Varies by data tier and order volume; subscription model.

**Regulatory:** Subject to CVM code-source inspection requirements.

**Source:** [Nelogica—ProfitDLL Ecosystem & Getting Started](https://ajuda.nelogica.com.br/hc/pt-br/articles/22396517026203-Ecossistema-ProfitDLL-e-primeiros-passos); [Nelogica—Request Access to ProfitDLL](https://ajuda.nelogica.com.br/hc/pt-br/articles/51583791325211-Como-obter-acesso-%C3%A0-ProfitDLL).

#### Tryd Platform

**What it is:** Standalone desktop trading platform; most widely used by Brazilian day traders.

**Order types:** Stocks, options, futures, commodities on B3.

**Characteristics:**

- Chart trading, trade pad (DOM), day trade book.
- Market replay for strategy testing.
- Mobile app (Android/iOS) for remote execution.
- Customizable interface.

**Access:** Requires account with Tryd or integrated broker.

**Costs:** Platform fee + brokerage (varies).

**Algorithmic capability:** Limited; primarily manual trading GUI. Not designed for third-party API integration.

**Source:** [Tryd—Trading Platform Overview](https://www.tryd.com.br/tryd).

#### Broker-Specific REST APIs

**BTG Pactual:**

- **API:** Empresas REST API (OAuth2/OpenID Connect)
- **Order endpoint:** Available for order creation with symbol, side, quantity, price, timeInForce parameters
- **SDK:** Python client (btgsolutions-tradeservices-python-client) on PyPI
- **Access:** Requires BTG Pactual account and API key registration
- **Documentation:** https://developers.empresas.btgpactual.com/docs/comecando

**XP Investimentos:**

- **API:** XP Inc Developer Portal offers REST APIs
- **Endpoints:** Account data, positions, movements, fundraising, commission
- **Open Finance:** Regulatory APIs required (data sharing, not order execution)
- **Access:** Requires XP account and developer registration
- **Documentation:** https://developer.xpinc.com/documentacao
- **Note:** Dedicated order execution API documentation not publicly detailed; may be available to institutional clients only

**Banco Inter:**

- **Home Broker:** Web/app-based order submission (no documented public REST API for retail)
- **Fees:** Zero brokerage and custody for stocks
- **Settlement:** Immediate execution and portfolio update
- **Programmatic access:** Not available to retail; MT5 integration possible through broker

**Clear:**

- **Order execution:** Part of XP Inc legal entity; uses XP infrastructure
- **API:** Minimal public documentation; likely shared with XP Investimentos
- **MT5:** Previously available; current status unclear
- **Retail access:** Home broker web/app interface only

**Rico:**

- **MT5 integration:** Available
- **REST API:** No public documentation for retail order execution
- **Home Broker:** Web/app-based (no documented API)

**Summary:** Only **BTG Pactual** offers a documented, OAuth2-authenticated REST API for retail order execution. XP Investimentos has APIs but order execution details are not public. Other brokers rely on MT5, Nelogica, or Tryd as intermediaries.

**Sources:** [BTG Pactual Developer Portal](https://developers.empresas.btgpactual.com/docs/comecando); [XP Inc Developer Portal](https://developer.xpinc.com/); [Banco Inter Home Broker Guide](https://ajuda.inter.co/investimentos/como-acompanhar-as-ordens-de-compra-de-acoes-e-fundos-imobiliarios-no-home-broker); [XP—Order Execution Capabilities](https://atendimento.xpi.com.br/artigo/3513-como-acessar-minhas-notas-de-corretagem-das-operacoes-em-bolsa).

### CVM Regulatory Framework for Retail Algorithmic Trading

**Direct Market Access (DMA) Categories:**

- **DMA 1:** OMS at client premises (rare, high cost)
- **DMA 2:** OMS at third-party provider (Bloomberg, ATG, Trading Technologies) — typically institutional
- **DMA II (Retail-capable):** Some third-party providers offer retail-accessible DMA (cost: EUR/USD 100s–1000s/month)

**Order internalization:** CVM **explicitly rejected** proposals for order internalization (brokers matching orders in internal systems without exchange). See CVM Public Hearing Report SDM 09/2019, Resolution 135/22 (June 2022). Retail orders must route to B3.

**Automated system requirements (Resolução CVM nº 21):**

- Source code or algorithm must be available for CVM inspection at company headquarters in uncompiled format.
- Applies to any systematic trading strategy deployed on a retail account.
- No specific registration required for personal retail traders using third-party platforms; compliance is broker's responsibility.

**Broker responsibility:** Intermediaries must implement risk controls, order transmission monitoring, and CVM code inspection cooperation.

**Retail status:** Retail individuals can use automated order systems (MT5, ProfitDLL, DMA platforms) if the broker provides them, subject to CVM oversight. No special "algorithmic trading registration" is required for the account owner (as of 2026), though this may evolve.

**Source:** [CVM Resolução nº 21 (Consolidated)](https://conteudo.cvm.gov.br/export/sites/cvm/legislacao/resolucoes/anexos/001/resol021consolid.pdf); [CVM Resolução nº 35 (Consolidated) - Direct Market Access rules](https://conteudo.cvm.gov.br/export/sites/cvm/legislacao/resolucoes/anexos/001/resol035consolid.pdf); [CVM Resolution 135/22 on Order Internalization](https://conteudo.cvm.gov.br/export/sites/cvm/legislacao/resolucoes/anexos/100/resol135.pdf).

---

## 6. COTAHIST Publication Timing

**Finding:** Exact publication time for the daily COTAHIST file is **not documented in publicly available B3 sources.**

**Known:**

- COTAHIST files are updated daily with the previous trading day's data.
- Files are available for download from B3's data portal.
- File format: COTAHIST.YYYYMMDD.txt (fixed-width text).
- Current-year file is updated daily; historical files are static.

**Inference from practice:**

- Community tools (rb3 R package, b3parser Python package) assume same-day (D+0) evening availability, typically after market close (17:30–18:00 BRT).
- No formal SLA or guarantee published by B3.

**To obtain exact timing:** Contact B3 Market Data services directly or consult internal B3 documentation (not public).

**Source:** [B3—Historical Quotations File Layout (COTAHIST)](https://www.b3.com.br/data/files/65/50/AD/26/29C8B51095EE46B5790D8AA8/HistoricalQuotations_B3.pdf); [rb3 R Package—Fetching Historical Equity Data](https://cran.r-project.org/web/packages/rb3/vignettes/Fetching-historical-equity-data.html).

---

## Summary Table: Broker Synchronisation & Order Execution Capabilities

| Capability                                   | Mechanism                                              | Requirements                                                         | Cost                                                    | Licensing Risk                                                          |
| -------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Sync equities from broker (Open Finance)** | B3 Área do Investidor + Pluggy/fintech                 | Fintech integration; broker must support Open Finance; D-1 data lag  | Pluggy: ~R$2,500/mo + per-transaction                   | Depends on fintech ToS; B3 API for institutional only                   |
| **Sync equities manually**                   | B3 Área do Investidor export (PDF/Excel)               | Login to investidor.b3.com.br; manual file download                  | None (free)                                             | Public portal; no licensing issue                                       |
| **Sync options/derivatives**                 | Custom parsing of Nota de Corretagem PDF               | Broker must email/generate SINACOR PDF; parse with custom code       | Time-intensive development                              | Open-source parsers (CorrePy, etc.); broker PDF ToS (likely permissive) |
| **Parse brokerage notes (equities)**         | CorrePy (Python) or parser-de-notas-de-corretagem (JS) | XP/Rico: use public parser; Inter: custom code required              | Free (open-source)                                      | Standard SINACOR; no licensing barrier                                  |
| **Place orders from app (programmatic)**     | BTG REST API                                           | BTG Pactual account; OAuth2 credentials; server-side request signing | Brokerage fees (varies); API: free                      | Standard OAuth2; CVM Resolution 21 source code available                |
| **Place orders from app (via MT5)**          | MetaTrader 5 platform + MQL5 scripts                   | Desktop MT5 running locally; broker must offer B3 gateway            | MT5: free (part of broker subscription); brokerage fees | MetaQuotes proprietary; broker responsible for CVM compliance           |
| **Place orders from app (via Nelogica)**     | ProfitDLL (Windows DLL) + C++/C#/Python/Delphi         | Nelogica Profit terminal subscription; Windows-only; local hosting   | Nelogica subscription (~R$200+/mo); brokerage fees      | Nelogica proprietary; CVM code-source inspection required               |
| **Market data (equities, daily)**            | COTAHIST B3 file download                              | FTP/HTTP download; no authentication                                 | Free (public)                                           | Public domain; B3 data redistribution restrictions apply                |
| **Market data (real-time)**                  | Broker feed (Bloomberg, Reuters) or B3 WebSocket API   | Subscription to data vendor or B3 API; institutional access          | 100s–1000s USD/month                                    | Vendor license; B3 API restricted to institutional clients              |

---

## Open Questions & Limitations

### Not Addressed by Primary Sources

1. **Exact COTAHIST release time**: B3 publishes daily but does not guarantee a specific hour. Assumed D+0 evening (post-market); verify with B3 directly.
2. **Pluggy broker coverage list**: Pluggy keeps it private; full list requires sales contact.
3. **XP REST API order execution scope**: Public documentation covers position/movement endpoints; order submission details not disclosed. May be institutional-only.
4. **Clear Corretora status**: Clear is part of XP Inc; current API and MT5 status unclear after 2024–2025 integration.
5. **BTG Pactual order execution SLA**: Documentation confirms endpoint; latency and order guarantee not specified.
6. **CVM guidance on personal web apps**: No specific rule for a personal Fetha-like app submitting orders to own account. Broker is CVM-regulated, not the app. Clarity may evolve.
7. **Options derivatives in Open Finance**: Not currently in scope. Future phases may add derivatives; monitor Open Finance Brasil roadmap.

### Known Gaps

- **Automated access to B3 Área do Investidor (retail):** Not possible without fintech intermediary or institutional partnership.
- **Derivatives/options data sync:** Open Finance Brasil does not cover; brokerage note parsing or broker-specific APIs are the only options.
- **Order execution fees:** Vary by broker, account type (day trader vs. position trader), and volume. Not standardized.
- **DMA latency/guarantees:** No published SLAs; real-time performance depends on broker infrastructure and order routing.

---

## Data Sources

### Primary Official Sources

1. **Open Finance Brasil Developer Area:** https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/103284839/APIs+-+Investimentos
2. **B3 Área do Investidor APIs:** https://developers.b3.com.br/apis/api-area-do-investidor
3. **B3 For Developers:** https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/b3-for-developers/
4. **CVM Resoluções nº 21, 35, 135:** https://conteudo.cvm.gov.br
5. **BTG Pactual Developer Portal:** https://developers.empresas.btgpactual.com
6. **XP Inc Developer Portal:** https://developer.xpinc.com/
7. **Pluggy—Open Finance Connectors:** https://docs.pluggy.ai/docs/open-finance-regulated
8. **Nelogica—ProfitDLL Documentation:** https://ajuda.nelogica.com.br

### Secondary & Community Sources

- SINACOR standard documentation: https://clientes.b3.com.br (restricted access); layout references in CorrePy and parser projects
- MetaTrader 5 B3 Gateway: https://www.metaquotes.net/
- COIR Brokerage Note Extractor: https://marcelopcf.github.io/COIR/
- rb3 R Package (COTAHIST access): https://docs.ropensci.org/rb3/

---

**Report compiled:** 2 September 2026  
**Fact-checking method:** Primary source documents, CVM official regulations, broker API documentation, and active community parser projects.  
**Disclaimer:** This report reflects the state of Brazilian broker APIs and regulations as of September 2026. Regulatory requirements and API availability are subject to change. Verify current terms with each broker and B3 before implementation.
