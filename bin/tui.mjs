export function multiSelect(options) {
  return new Promise((done) => {
    const selected = options.map(() => false);
    let cursor = 0;

    const render = () => {
      process.stdout.write(`\x1b[${options.length}A`);
      options.forEach((opt, i) => {
        const check = selected[i] ? 'x' : ' ';
        const arrow = i === cursor ? '>' : ' ';
        process.stdout.write(`\x1b[2K${arrow} [${check}] ${opt.label}\n`);
      });
    };

    console.log('\nSelect tools (arrows to move, space to toggle, enter to confirm):\n');
    options.forEach((opt, i) => {
      const arrow = i === cursor ? '>' : ' ';
      console.log(`${arrow} [ ] ${opt.label}`);
    });

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = (key) => {
      if (key === '\x1b[A') { cursor = (cursor - 1 + options.length) % options.length; render(); }
      else if (key === '\x1b[B') { cursor = (cursor + 1) % options.length; render(); }
      else if (key === ' ') { selected[cursor] = !selected[cursor]; render(); }
      else if (key === 'a') { const allOn = selected.every(Boolean); selected.fill(!allOn); render(); }
      else if (key === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onKey);
        console.log('');
        done(options.filter((_, i) => selected[i]).map(o => o.value));
      }
      else if (key === '\x03') { process.exit(0); }
    };

    process.stdin.on('data', onKey);
  });
}

export function singleSelect(prompt, options) {
  return new Promise((done) => {
    let cursor = 0;
    let scrollOffset = 0;
    const maxVisible = Math.min(options.length, (process.stdout.rows || 24) - 4);
    const needsScroll = options.length > maxVisible;
    const renderedLines = maxVisible + (needsScroll ? 2 : 0);

    const clampScroll = () => {
      if (cursor < scrollOffset) scrollOffset = cursor;
      if (cursor >= scrollOffset + maxVisible) scrollOffset = cursor - maxVisible + 1;
    };

    const render = () => {
      process.stdout.write(`\x1b[${renderedLines}A`);
      if (needsScroll) {
        const upHint = scrollOffset > 0 ? `  ↑ ${scrollOffset} more` : '';
        process.stdout.write(`\x1b[2K${upHint}\n`);
      }
      for (let i = scrollOffset; i < scrollOffset + maxVisible; i++) {
        const arrow = i === cursor ? '>' : ' ';
        process.stdout.write(`\x1b[2K${arrow} ${options[i].label}\n`);
      }
      if (needsScroll) {
        const below = options.length - scrollOffset - maxVisible;
        const downHint = below > 0 ? `  ↓ ${below} more` : '';
        process.stdout.write(`\x1b[2K${downHint}\n`);
      }
    };

    console.log(`\n${prompt}\n`);
    clampScroll();
    if (needsScroll) console.log('');
    for (let i = scrollOffset; i < scrollOffset + maxVisible; i++) {
      const arrow = i === cursor ? '>' : ' ';
      console.log(`${arrow} ${options[i].label}`);
    }
    if (needsScroll) {
      const below = options.length - scrollOffset - maxVisible;
      console.log(below > 0 ? `  ↓ ${below} more` : '');
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = (key) => {
      if (key === '\x1b[A') { cursor = (cursor - 1 + options.length) % options.length; clampScroll(); render(); }
      else if (key === '\x1b[B') { cursor = (cursor + 1) % options.length; clampScroll(); render(); }
      else if (key === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onKey);
        console.log('');
        done(options[cursor].value);
      }
      else if (key === '\x03') { process.exit(0); }
    };

    process.stdin.on('data', onKey);
  });
}
