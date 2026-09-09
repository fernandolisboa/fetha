export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(input: SendEmailInput): Promise<void>;
}
