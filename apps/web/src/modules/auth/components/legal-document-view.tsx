import type { LegalDocument } from "../legal-text";

export function LegalDocumentView({ document }: { document: LegalDocument }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-xl font-semibold tracking-tight">{document.title}</h1>
      <p className="text-muted-foreground mt-1 text-xs">{document.updated}</p>
      <div className="mt-8 flex flex-col gap-6">
        {document.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="text-[15px] font-medium">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-muted-foreground text-sm leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
