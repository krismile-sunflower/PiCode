import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Curated highlight.js build.
 *
 * `highlight.js/lib/common` pulls in ~37 grammars; this list covers what a Pi
 * session actually prints while keeping the bundle roughly half that size.
 * Anything unregistered still renders — just without colors.
 */
const languages = {
  bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, kotlin,
  markdown, php, powershell, python, ruby, rust, shell, sql, swift, typescript,
  xml, yaml,
};

for (const [name, definition] of Object.entries(languages)) {
  hljs.registerLanguage(name, definition);
}

// Aliases people actually type in fences.
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['sh', 'zsh', 'shell'], { languageName: 'bash' });
hljs.registerAliases(['html', 'vue', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['toml'], { languageName: 'ini' });
hljs.registerAliases(['ps1', 'pwsh'], { languageName: 'powershell' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['rs'], { languageName: 'rust' });
hljs.registerAliases(['patch'], { languageName: 'diff' });

hljs.configure({ classPrefix: 'hljs-' });

export default hljs;
