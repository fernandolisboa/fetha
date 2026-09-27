export interface LegalSection {
  heading: string;
  paragraphs: readonly string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  sections: readonly LegalSection[];
}

// The text states what the code does (docs/adr/0027 item 4): a change to
// retention, processors or rights must change it too, and bump
// CURRENT_TERMS_VERSION (terms.ts).
const en: { terms: LegalDocument; privacy: LegalDocument } = {
  terms: {
    title: "Terms of use",
    updated: "Version of 26/09/2026",
    sections: [
      {
        heading: "What Fetha is",
        paragraphs: [
          "Fetha is a free, personal lab for studying investments on the Brazilian market (B3). It computes indicators, option prices and greeks, payoffs of structures and backtests, and keeps a journal of the decisions you record. There are no fees and no plans.",
        ],
      },
      {
        heading: "Every decision is your own",
        paragraphs: [
          "Fetha is not a broker, does not place or automate orders and does not connect to any broker. It is not investment advice, a recommendation or securities analysis in the sense of CVM rules.",
          "Every figure is an estimate from models and past data (for example, Black-Scholes prices and closing quotes) and can differ from the market. A backtest shows how a rule would have behaved in the past and promises nothing about the future. Every decision you take, in Fetha or outside it, is yours alone, and so are its results.",
        ],
      },
      {
        heading: "Market data",
        paragraphs: [
          "Reference data comes from public sources (B3 files, the Central Bank's SGS series and the ANBIMA calendar) and may be late, incomplete or wrong. Fetha gives no guarantee about it.",
        ],
      },
      {
        heading: "Data provider tokens",
        paragraphs: [
          "If you enter a token from a market data provider (such as brapi.dev), you are responsible for holding a valid subscription and for following that provider's terms. Fetha uses the token only to fetch data for you, and what it fetches stays in your account alone.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: [
          "One account per person. Keep your password to yourself: you answer for what is done with your account. Do not use Fetha for anything unlawful, do not try to reach other people's data and do not overload the service.",
          "A strategy you mark as shared becomes visible, read-only, to every other user, with its name and every version of its definition, but without your name or your backtests, and they can copy it into their own space. Nothing else you record is ever shared.",
        ],
      },
      {
        heading: "Availability and liability",
        paragraphs: [
          "Fetha is offered as is, with no promise of availability, and may change or end. To the extent the law allows, its maintainer is not liable for losses arising from decisions taken with or without it.",
        ],
      },
      {
        heading: "Ending and changes",
        paragraphs: [
          "You can delete your account at any time under Configurações; everything tied to it is deleted at once.",
          "A new version of these terms carries a new date at the top. These terms are governed by Brazilian law.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy policy",
    updated: "Version of 26/09/2026",
    sections: [
      {
        heading: "Who handles your data",
        paragraphs: [
          "Fetha is a personal project kept by its developer, who is the controller of the personal data described here under the LGPD (Law 13,709/2018). Requests about your data can be made through the project's repository at github.com/fernandolisboa/fetha; most of them you can also carry out yourself under Configurações.",
        ],
      },
      {
        heading: "What is collected",
        paragraphs: [
          "Registration: your name, your email and your password, stored only as a one-way hash, plus which version of these terms you accepted and when.",
          "Sessions: when you signed in, the IP address and the browser.",
          "What you enter: your watchlist, strategies and their versions, declared risk profile and capital, contemplated operations, fills entered by hand or imported from the B3 spreadsheet, operations, backtests, decisions with their theses, and your theme and layout preferences.",
          "Invitation: when sign-up is by invitation only, the invited email is recorded, and it is deleted when the account created with it is deleted.",
          "What Fetha computes for you: signals, strategy evaluations and decision scores.",
          "Access log: each read or export of your portfolio and decision data, with the date, the IP address and the browser.",
        ],
      },
      {
        heading: "Why, and on what legal basis",
        paragraphs: [
          "Your account data and what you enter are processed to provide the service you signed up for (LGPD art. 7, V). Sessions, the access log and sign-in attempt limits exist to keep your account secure and to show you who reached your data (art. 7, IX).",
          "Fetha has no advertising, sells no data and runs no third-party analytics or tracking.",
        ],
      },
      {
        heading: "Who else processes it",
        paragraphs: [
          "Three providers run the service on Fetha's behalf: Vercel (hosting), Neon (the Postgres database) and Resend (sending email). All three store data in the United States, so your data is transferred abroad under LGPD art. 33. No one else receives it.",
        ],
      },
      {
        heading: "How long it is kept",
        paragraphs: [
          "Your data is kept while your account exists. Access log entries are deleted after 180 days. Each email typed into sign-in, magic link, password reset or verification resend, and your account's email when you export your data or delete your account, is kept only as a SHA-256 hash, to limit repeated tries. That hash is erased by the first attempt anyone makes on Fetha once a minute has passed since the last one. Verification, magic link and password reset links expire within five minutes to one hour.",
          "When you delete your account, everything tied to it is deleted at once. The database provider's backups expire on their own within its retention window, and emails already sent remain in your inbox and in Resend's delivery records. Copies other users made of a strategy you shared stay with them, with no link to your account.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "Under LGPD art. 18 you can confirm and access your data, take a copy of it, have it corrected, and have it deleted. Under Configurações you can export everything as one JSON file, see the access log and delete your account yourself. For anything else, such as correcting your name or email, use the contact above.",
        ],
      },
      {
        heading: "Security, cookies and the installed app",
        paragraphs: [
          "Traffic is encrypted, passwords are hashed, every query is limited to your own data, and sign-in attempts are rate limited.",
          "Fetha sets only the cookies needed to keep you signed in. The installed app caches its own files so it opens offline; it never stores your data in that cache.",
        ],
      },
      {
        heading: "Age and changes",
        paragraphs: [
          "Fetha is not meant for people under 18.",
          "A new version of this policy carries a new date at the top.",
        ],
      },
    ],
  },
};

const ptBR: typeof en = {
  terms: {
    title: "Termos de uso",
    updated: "Versão de 26/09/2026",
    sections: [
      {
        heading: "O que é o Fetha",
        paragraphs: [
          "O Fetha é um laboratório pessoal e gratuito para estudar investimentos no mercado brasileiro (B3). Ele calcula indicadores, preços e gregas de opções, payoffs de estruturas e backtests, e mantém um diário das decisões que você registra. Não há taxas nem planos.",
        ],
      },
      {
        heading: "Toda decisão é sua",
        paragraphs: [
          "O Fetha não é corretora, não envia nem automatiza ordens e não se conecta a nenhuma corretora. Também não é consultoria, recomendação de investimento ou análise de valores mobiliários nos termos das normas da CVM.",
          "Todo número exibido é uma estimativa feita com modelos e dados passados (por exemplo, preços pelo modelo de Black-Scholes e cotações de fechamento) e pode ser diferente do mercado. Um backtest mostra como uma regra teria se comportado no passado e não garante nada sobre o futuro. Toda decisão que você tomar, dentro ou fora do Fetha, é só sua, assim como os resultados dela.",
        ],
      },
      {
        heading: "Dados de mercado",
        paragraphs: [
          "Os dados de referência vêm de fontes públicas (arquivos da B3, séries do SGS do Banco Central e calendário da ANBIMA) e podem chegar atrasados, incompletos ou com erros. O Fetha não dá garantia sobre eles.",
        ],
      },
      {
        heading: "Tokens de provedores de dados",
        paragraphs: [
          "Se você informar um token de um provedor de dados de mercado (como o brapi.dev), é sua a responsabilidade de manter uma assinatura válida e seguir os termos desse provedor. O Fetha usa o token só para buscar dados para você, e o que ele busca fica apenas na sua conta.",
        ],
      },
      {
        heading: "Sua conta",
        paragraphs: [
          "Uma conta por pessoa. Não compartilhe sua senha: você responde pelo que for feito com a sua conta. Não use o Fetha para nada ilícito, não tente acessar dados de outras pessoas e não sobrecarregue o serviço.",
          "Uma estratégia que você marcar como compartilhada fica visível, só para leitura, a todos os outros usuários, com o nome e todas as versões da definição, mas sem o seu nome nem os seus backtests, e eles podem copiá-la para o próprio espaço. Nenhum outro dado que você registra é compartilhado.",
        ],
      },
      {
        heading: "Disponibilidade e responsabilidade",
        paragraphs: [
          "O Fetha é oferecido como está, sem promessa de disponibilidade, e pode mudar ou ser encerrado. Na medida permitida pela lei, quem o mantém não responde por perdas decorrentes de decisões tomadas com ou sem ele.",
        ],
      },
      {
        heading: "Encerramento e mudanças",
        paragraphs: [
          "Você pode excluir sua conta a qualquer momento em Configurações; tudo o que está ligado a ela é apagado na hora.",
          "Uma nova versão destes termos traz uma nova data no topo. Estes termos seguem a lei brasileira.",
        ],
      },
    ],
  },
  privacy: {
    title: "Política de privacidade",
    updated: "Versão de 26/09/2026",
    sections: [
      {
        heading: "Quem cuida dos seus dados",
        paragraphs: [
          "O Fetha é um projeto pessoal mantido pelo seu desenvolvedor, que é o controlador dos dados pessoais descritos aqui nos termos da LGPD (Lei 13.709/2018). Pedidos sobre seus dados podem ser feitos pelo repositório do projeto em github.com/fernandolisboa/fetha; a maioria deles você também resolve sozinho em Configurações.",
        ],
      },
      {
        heading: "O que é coletado",
        paragraphs: [
          "Cadastro: seu nome, seu e-mail e sua senha, guardada apenas como hash irreversível, além de qual versão destes termos você aceitou e quando.",
          "Sessões: quando você entrou, o endereço IP e o navegador.",
          "O que você informa: sua watchlist, suas estratégias e versões, o perfil de risco e o capital declarados, operações em estudo, execuções lançadas manualmente ou importadas da planilha da B3, operações, backtests, decisões com suas teses e suas preferências de tema e de layout.",
          "Convite: quando o cadastro é só por convite, o e-mail convidado fica registrado e é apagado quando a conta criada com ele é excluída.",
          "O que o Fetha calcula para você: sinais, avaliações de estratégias e pontuações de decisões.",
          "Registro de acesso: cada leitura ou exportação dos dados da sua carteira e das suas decisões, com data, endereço IP e navegador.",
        ],
      },
      {
        heading: "Para quê, e com qual base legal",
        paragraphs: [
          "Os dados da sua conta e o que você informa são tratados para prestar o serviço em que você se cadastrou (art. 7º, V, da LGPD). Sessões, registro de acesso e limite de tentativas de login existem para proteger sua conta e mostrar a você quem acessou seus dados (art. 7º, IX).",
          "O Fetha não tem publicidade, não vende dados e não usa ferramentas de análise ou rastreamento de terceiros.",
        ],
      },
      {
        heading: "Quem mais trata os dados",
        paragraphs: [
          "Três fornecedores operam o serviço em nome do Fetha: Vercel (hospedagem), Neon (banco de dados Postgres) e Resend (envio de e-mails). Os três guardam dados nos Estados Unidos, o que configura transferência internacional nos termos do art. 33 da LGPD. Ninguém mais recebe seus dados.",
        ],
      },
      {
        heading: "Por quanto tempo",
        paragraphs: [
          "Seus dados ficam guardados enquanto sua conta existir. Os registros de acesso são apagados depois de 180 dias. Cada e-mail digitado no login, no link mágico, na redefinição de senha ou no reenvio da verificação, e o e-mail da sua conta quando você exporta seus dados ou exclui a conta, é guardado só como hash SHA-256, para limitar tentativas repetidas. Esse hash é apagado na primeira tentativa feita no Fetha, por qualquer pessoa, depois de passado um minuto da última. Os links de verificação, os links mágicos e os de redefinição de senha expiram entre cinco minutos e uma hora.",
          "Quando você exclui sua conta, tudo o que está ligado a ela é apagado na hora. As cópias de segurança do provedor do banco de dados expiram sozinhas dentro do prazo de retenção dele, e os e-mails já enviados continuam na sua caixa de entrada e nos registros de entrega do Resend. Cópias que outros usuários fizeram de uma estratégia sua compartilhada continuam com eles, sem ligação com a sua conta.",
        ],
      },
      {
        heading: "Seus direitos",
        paragraphs: [
          "Pelo art. 18 da LGPD, você pode confirmar e acessar seus dados, levar uma cópia deles, pedir correção e pedir exclusão. Em Configurações você exporta tudo em um único arquivo JSON, consulta o registro de acesso e exclui sua conta sozinho. Para o resto, como corrigir seu nome ou e-mail, use o contato acima.",
        ],
      },
      {
        heading: "Segurança, cookies e o aplicativo instalado",
        paragraphs: [
          "O tráfego é criptografado, as senhas são guardadas como hash, toda consulta se limita aos seus próprios dados e as tentativas de login têm limite.",
          "O Fetha usa apenas os cookies necessários para manter você conectado. O aplicativo instalado guarda os próprios arquivos para abrir sem conexão, mas nunca guarda seus dados nesse cache.",
        ],
      },
      {
        heading: "Idade e mudanças",
        paragraphs: [
          "O Fetha não é destinado a menores de 18 anos.",
          "Uma nova versão desta política traz uma nova data no topo.",
        ],
      },
    ],
  },
};

export const legalText = { en, ptBR } as const;
