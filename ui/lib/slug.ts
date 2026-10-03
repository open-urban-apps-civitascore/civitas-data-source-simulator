/** `VerkehrsZählung Süd` becomes `verkehrs-zaehlung-sued`. */
export function slugify(name: string, maxLength = Infinity): string {
  return name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1-$2")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, "");
}

/** Never shortened: two names that start alike must not share a topic. */
export function topicFor(name: string): string {
  const slug = slugify(name);
  return slug ? `civitas/${slug}` : "";
}
