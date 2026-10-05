import { describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';

describe('notification template sanitizer dependency', () => {
  it('retains span styling while removing scripts, handlers and other tags', () => {
    const output = DOMPurify.sanitize('<span class="preview" onclick="alert(1)">Safe</span><script>alert(1)</script><img src=x onerror="alert(1)">', {
      ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'],
    });
    expect(output).toBe('<span class="preview">Safe</span>');
  });
});
