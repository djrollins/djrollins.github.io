---
layout: post
title: "Safer logging in Pino with explicit include paths"
description: "It's better to log nothing at all, rather than PII"
tags: [javascript, typescript, aws, lamda, tip, pino]
---

At Infinity Works we place a high value on operational observability and
constantly strive for high-quality log messages across all of our projects. One
key aspect to high-quality logs is to make sure that each log entry is
meaningful in isolation, which means it is encouraged to try and include a
decent amount of contextual information so that the log message makes sense
without necessarily needing any other surrounding entries.

This approach comes with a few caveats. Teams that try to log lots of contextual
information run the risk of potentially leaking confidential or personally
identifiable information (PII). This is especially important for a number of our
clients in the Health and Finance sectors. We do our best to make sure we cover
what is being logged as part of any code review, however, in some cases
inclusion of PII may not be observable during code review, e.g. when an existing
log message ends up accidentally including PII at a later date after a change is
made upstream.

In an attempt to combat these sorts of problems, logging libraries such as Pino
provide a mechanism for trying removing or masking information from logs based
on regular expressions, keywords or paths.

A colleague of mine recently commented in our Engineering Community of Practice
Slack channel that they spend a lot of time trying to maintain lists of
exclusion paths in the their logger configuration and there is always a worry
that they may not have caught all confidential information or PII. In the end,
they decided to remove all contextual information from their logs and steadily
start reintroducing it back over time.

Unfortunately, Pino only supports exclusion paths and offers no immediately
obvious way to specify inclusion paths, which is making the transition more
burdensome than it needs to be. My colleagued asked if there were any other
logging libraries that offered this functionality.

```typescript
{% include 2021-09-20-include-fields-logger/src/before.ts %}
```
