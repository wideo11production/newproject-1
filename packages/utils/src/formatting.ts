export function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function capitalizeWords(str: string): string {
  return str
    .split(" ")
    .map((word) => capitalize(word))
    .join(" ");
}

export function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${plural || singular + "s"}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix = (s[(v - 20) % 10] ?? s[v] ?? s[0]) as string;
  return n + suffix;
}

export function maskString(str: string, visibleStart = 4, visibleEnd = 4, maskChar = "*"): string {
  if (str.length <= visibleStart + visibleEnd) return str;
  const start = str.slice(0, visibleStart);
  const end = str.slice(-visibleEnd);
  const masked = maskChar.repeat(str.length - visibleStart - visibleEnd);
  return start + masked + end;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return maskString(email);
  return maskString(local, 2, 1) + "@" + domain;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return maskString(digits, 3, 2);
}

export function formatFileSize(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function formatBitrate(bps: number): string {
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let value = bps;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatResolution(width: number, height: number): string {
  return `${width}x${height}`;
}

export function formatAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export function truncateHtml(html: string, maxLength: number): string {
  const stripped = stripHtml(html);
  if (stripped.length <= maxLength) return html;
  return truncatedHtml(html, maxLength);
}

function truncatedHtml(html: string, maxLength: number): string {
  let result = "";
  let length = 0;
  const stack: string[] = [];

  const regex = /(<[^>]+>)|([^<]+)/g;
  let match;

  while ((match = regex.exec(html)) !== null && length < maxLength) {
    const [_full, tag, text] = match;
    if (tag) {
      result += tag;
      const tagName = tag.match(/<\/?(\w+)/)?.[1];
      if (tagName && !tag.startsWith("</")) {
        if (!["br", "hr", "img", "input", "meta", "link"].includes(tagName)) {
          stack.push(tagName);
        }
      } else if (tagName) {
        const index = stack.lastIndexOf(tagName);
        if (index !== -1) stack.splice(index, 1);
      }
    } else if (text) {
      const remaining = maxLength - length;
      if (text.length <= remaining) {
        result += text;
        length += text.length;
      } else {
        result += text.slice(0, remaining) + "...";
        length = maxLength;
      }
    }
  }

  while (stack.length > 0) {
    result += `</${stack.pop()}>`;
  }

  return result;
}