const en = {
  signUp: {
    title: "Create your account",
    subtitle: "Register to start studying and backtesting your own strategies.",
    nameLabel: "Name",
    emailLabel: "Email",
    passwordLabel: "Password",
    termsLabel: "I accept the terms of use",
    privacyLabel: "I accept the privacy policy",
    submit: "Register",
    alreadyHaveAccount: "Already registered?",
    signInLink: "Sign in",
  },
  signIn: {
    title: "Sign in",
    subtitle: "Enter your email and password to access your lab.",
    emailLabel: "Email",
    passwordLabel: "Password",
    submit: "Sign in",
    noAccount: "Not registered yet?",
    signUpLink: "Register",
  },
  verifyEmail: {
    title: "Confirm your registration",
    body: "We sent a confirmation link to {email}. Click the link to confirm your registration.",
    resend: "Resend email",
    resent: "We sent the email again.",
  },
  verificationResult: {
    successTitle: "Email confirmed",
    successBody: "Your email is confirmed. You can sign in now.",
    errorTitle: "We couldn't confirm your email",
    errorBody: "This confirmation link is invalid or has expired. Request a new one below.",
    signInLink: "Go to sign-in",
    resendLink: "Request a new confirmation link",
  },
  terms: {
    title: "Terms of use",
    body: "Content in progress.",
  },
  privacy: {
    title: "Privacy policy",
    body: "Content in progress.",
  },
  errors: {
    invalidInput: "Check the fields highlighted below.",
    termsRequired: "You must accept the terms of use and the privacy policy.",
    registrationClosed: "Registration is closed at the moment.",
    signUpFailed: "We couldn't complete your registration. Try again.",
    invalidCredentials: "Incorrect email or password.",
    emailNotVerified: "Confirm your email before signing in.",
    rateLimited: "Too many attempts. Wait a moment and try again.",
    signInFailed: "We couldn't sign you in. Try again.",
    resendFailed: "We couldn't resend the email. Try again.",
  },
  verificationEmail: {
    subject: "Confirm your email at Fetha",
    text: "Hello, {name}. Confirm your email to start using Fetha: {url}\n\nIf you didn't create this account, ignore this email.",
    html: '<p>Hello, {name}.</p><p>Confirm your email to start using Fetha:</p><p><a href="{url}">{url}</a></p><p>If you didn\'t create this account, ignore this email.</p>',
  },
  signOut: "Sign out",
};

const ptBR = {
  signUp: {
    title: "Crie sua conta",
    subtitle: "Cadastre-se para estudar e testar suas próprias estratégias.",
    nameLabel: "Nome",
    emailLabel: "E-mail",
    passwordLabel: "Senha",
    termsLabel: "Aceito os termos de uso",
    privacyLabel: "Aceito a política de privacidade",
    submit: "Criar conta",
    alreadyHaveAccount: "Já tem conta?",
    signInLink: "Entrar",
  },
  signIn: {
    title: "Entrar",
    subtitle: "Informe seu e-mail e sua senha para acessar seu laboratório.",
    emailLabel: "E-mail",
    passwordLabel: "Senha",
    submit: "Entrar",
    noAccount: "Ainda não tem conta?",
    signUpLink: "Criar conta",
  },
  verifyEmail: {
    title: "Confirme seu cadastro",
    body: "Enviamos um link de confirmação para {email}. Clique no link para confirmar seu cadastro.",
    resend: "Reenviar e-mail",
    resent: "Enviamos o e-mail novamente.",
  },
  verificationResult: {
    successTitle: "E-mail confirmado",
    successBody: "Seu e-mail foi confirmado. Você já pode entrar.",
    errorTitle: "Não foi possível confirmar seu e-mail",
    errorBody: "Esse link de confirmação é inválido ou expirou. Peça um novo abaixo.",
    signInLink: "Ir para a tela de entrada",
    resendLink: "Pedir um novo link de confirmação",
  },
  terms: {
    title: "Termos de uso",
    body: "Conteúdo em elaboração.",
  },
  privacy: {
    title: "Política de privacidade",
    body: "Conteúdo em elaboração.",
  },
  errors: {
    invalidInput: "Confira os campos destacados abaixo.",
    termsRequired: "Você precisa aceitar os termos de uso e a política de privacidade.",
    registrationClosed: "O cadastro está fechado no momento.",
    signUpFailed: "Não foi possível concluir seu cadastro. Tente novamente.",
    invalidCredentials: "E-mail ou senha incorretos.",
    emailNotVerified: "Confirme seu e-mail antes de entrar.",
    rateLimited: "Muitas tentativas seguidas. Aguarde um instante e tente de novo.",
    signInFailed: "Não foi possível entrar. Tente novamente.",
    resendFailed: "Não foi possível reenviar o e-mail. Tente novamente.",
  },
  verificationEmail: {
    subject: "Confirme seu e-mail no Fetha",
    text: "Olá, {name}. Confirme seu e-mail para começar a usar o Fetha: {url}\n\nSe você não criou esta conta, ignore este e-mail.",
    html: '<p>Olá, {name}.</p><p>Confirme seu e-mail para começar a usar o Fetha:</p><p><a href="{url}">{url}</a></p><p>Se você não criou esta conta, ignore este e-mail.</p>',
  },
  signOut: "Sair",
} satisfies typeof en;

export const authStrings = { en, ptBR } as const;

export const t = authStrings.ptBR;
