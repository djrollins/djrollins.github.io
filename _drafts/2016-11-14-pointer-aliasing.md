---
layout: post
title: "Pointer Aliasing: Subtle changes, Large performance implications"
description: ""
tags: [c, assembly, pointers, performance]
---

I am currently in the process of writing a software renderer in C for a game
using the X11 library as a back end. At the moment it manages to create a window
and render a scrolling pattern in to it, which isn't too exciting, but even
with a small amount of code I have learned first hand how damaging pointer
aliasing can be to performance critical code.

![Amazing screenshot]({{ site.url }}/assets/img/2016/10/Frametiming.png)

The code to render the pattern was fairly trivial:

```c
static void update_window(
        Window window, GC gc,
        int width, int height,
        int xoffset, int yoffset)
{
    if (!pixels)
        resize_ximage(width, height);

    uint32_t *pixel = (uint32_t*)pixels;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            uint8_t blue  = (x + xoffset);
            uint8_t green = (y + yoffset);
            uint8_t red   = 0;
            uint8_t alpha = 255;

            *pixel++ = (alpha << 24) | (red << 16) | (green << 8) | blue;
        }
    }

    XPutImage(
            display, window,
            gc, &ximage,
            0, 0,
            0, 0,
            width, height);
}
```

The first allocates a back-buffer if it has not done so already and then loops
through each of the pixels and assigns a colour to each one based in it's XY
position and an XY offset provided as an argument. The `XPutImage` function then
copies the data from the back-buffer int to the buffer that is displayed in the
window.

As you'll probably notice, this function not only has a large number of input
parameters, but also modifies a lot of global state (`pixels`, `display` and
`ximage`). I'm not proud of this code and was hesitant to post it, but hopefully
you'll appreciate it was a rapid prototype and will forgive me.

In order to clean up the code I decided to gather all of the global state and
window data into a global `x11_context` struct that would eventually become
local data that is passed as pointer into each of the functions that require it.

```c
struct x11_context context;

static void update_window(int xoffset, int yoffset)
{
    if (!context.backbuffer.pixels)
        resize_ximage(context.width, context.height);

    uint32_t *pixel = (uint32_t*)context.backbuffer.pixels;
    for (int y = 0; y < context.height; ++y) {
        for (int x = 0; x < context.width; ++x) {
            uint8_t blue  = (x + xoffset);
            uint8_t green = (y + yoffset);
            uint8_t red   = 0;
            uint8_t alpha = 255;

            *pixel++ = (alpha << 24) | (red << 16) | (green << 8) | blue;
        }
    }

    XPutImage(
            context.display, context.window,
            context.gc, &context.ximage,
            0, 0,
            0, 0,
            context.width, context.height);
}
```

After this refactor I was surprised to be hit with a **35%** increase in
frame time compared with the old code (4.1ms -> 5.7ms). Almost immediately, I
assumed I'd introduced some manner of pointer aliasing into the loop, but was
somewhat confused as there was only a single pointer-dereference in the loop.

## Pointer Aliasing

Experienced C and C++ programmers will already know about pointer aliasing and
how it effects compiler optimisations, but it's worth going over here if only to
cement it in my mind.

A good, albeit contrived, example to demonstrate pointer aliasing is as can be
seen on the Wikipedia page for the
[`restrict`](https://en.wikipedia.org/wiki/Restrict) keyword:

```c
void updatePtrs(size_t *ptrA, size_t *ptrB, size_t *val)
{
  *ptrA += *val;
  *ptrB += *val;
}
```

The values pointed to by `ptrA` and `ptrB` are updated with the value pointed to
by `val`. An optimizing compiler would love to cache the value pointed to by
`val` so that it only has to deference the pointer once. Unfortunately, `val`
and `ptrA` could theoretically point to the same memory location, therefore the
compiler cannot possible know, or assume, that they don't. This means that the
value pointed to by `val` cannot be cached because updating `ptrA` could modify
`val` and the compiler is forced to keep the second load of `val` just in case.

The fix for this is to use the `restrict` keyword which informs the compiler
that the pointers all point to different locations and the onus is on the
programmer to make sure that they don't.  

```c
void updatePtrs(
    size_t *restrict ptrA,
    size_t *restrict ptrB,
    size_t *restrict val);
```

We could also manually cache the value ourselves, however this does not
obviously signify that it is the clients job to make sure the pointers do not
alias each other.

```c
void updatePtrs(size_t *ptrA, size_t *ptrB, size_t *val)
{
  size_t value = *val;
  *ptrA += value;
  *ptrB += value;
}
```

## `perf` to the Rescue

In the `update_window` function above, there is only one pointer being
dereferenced in the loop, so how can there be aliasing? If I'd been
concentrating harder and thought about it I probably would have seen it but I
decided to crack out the `perf` profiling tool to find the hotspots in the
assembly.

```
       │             for (int x = 0; x < context.width; ++x) {
  0.04 │       add    $0x1,%edx
       │                 *pixel++ = (alpha << 24) | (red << 16) | (green << 8) | blue;
 33.32 │       or     %edi,%eax
  0.02 │       add    $0x1,%ecx
 31.39 │       mov    %eax,-0x4(%rsi)
       │             for (int x = 0; x < context.width; ++x) { 2.85 │       mov    context+0xe4,%eax
 31.84 │       cmp    %eax,%edx
       │     ↑ jl     3b8
  0.37 │       mov    context+0xe8,%edx

```

`perf` found that **95%** samples occurred in the region around the inner loop
condition statement[^1]. Specifically the `mov %eax,-0x4(%rsi)` instruction,
which is the storing of the shift expression into the pixel memory location
and the `mov context+0xe4,%eax` instruction which is the load from the
`context.width` memory location into to the `eax` register to compare with the
loop variable in `edx`.

I then had the realisation that the compiler cannot assume that `pixels` does
not point to the memory location where `context`, and therefore `context.width`
resides, meaning that it needs to be reloaded every time through through the
loop. When `width` and `height` were passed in as parameters, they were
allocated on `update_window`'s stack and therefore `pixels` could never point
them (ignoring possible undefined behaviour) and it could keep `width` in a
register, knowing it wouldn't change.

This made me realise the pointer aliasing occurs not only between pointers, but
but between a pointer and any variable that is not allocated on stack-frame of
the currently executing function.  The Solution
------------

The solution to the this issue was to cache the `width` and `height` into a
local variable that was used as part of the loop condition. I would usually do
this anyway, however a quick find and replace led me to oversee this omission
and I paid dearly with massive performance hit.


```c
/* x11_context struct now passed in as a parameter as well */
static void update_window(
    struct x11_context *context,
    int xoffset, int yoffset)
{
    int width = context->width;
    int height = context->height;

    if (!context->backbuffer.pixels)
        resize_ximage(width, height);

    uint32_t *pixel = (uint32_t*)context->backbuffer.pixels;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            uint8_t blue  = (x + xoffset);
            uint8_t green = (y + yoffset);
            uint8_t red   = 0;
            uint8_t alpha = 255;

            *pixel++ = (alpha << 24) | (red << 16) | (green << 8) | blue;
        }
    }

    XPutImage(
            context->display, context->window,
            context->gc, &context->ximage,
            0, 0,
            0, 0,
            width, height);
}
```

The resulting `perf` output does not show any hotspots, not even in the store to
into the `pixel` address, as the compiler was able optimise away the load on
every iteration and go even further and unroll the loop as it was able to
determine that my `width` and `height` were constants elsewhere in the code.

Quick look at the unoptimised assembly
--------------------------------------

All of the above was discussed in terms of optimised builds as that is where
the most significant difference in performance was apparent. However, comparing
the generated assembly for optimised builds is tricky as slight changes in the
code can generate drastically different instructions depending on what
assumptions the optimiser can make.

That said, it it's worth taking a quick look at the difference between the
unoptimised assembly as it becomes obvious how pointer aliasing affects the
compiler. 

```diff
$ diff struct_good/objdump struct_bad/objdump
86c86
<         for (int x = 0; x < width; ++x) {
---
>         for (int x = 0; x < context->width; ++x) {
88,90c88,91
<       mov    -0x1c(%rbp),%eax             # Move loop variable (i) into eax
<       cmp    -0x20(%rbp),%eax             # Compare cached width with eax
<       jl     400f9d <update_window+0x89>  # Jump to start of loop if eax < width
---
>       mov    -0x38(%rbp),%rax             # Move context address into rax
>       mov    0xe0(%rax),%eax              # Move width into eax
>       cmp    -0x1c(%rbp),%eax             # Compare loop variable (i) with eax
>       jg     400fa0 <update_window+0x8c>  # Jump to start of loop if eax > i
```

The generated assembly for the code where `width` is _not_ cached requires
loading the `context` pointer and then loads the `width` from an offset from
that address into a register to compare with the loop variable, `i` on the
stack. In the code where `width` cached, it the compiler keeps it around on the
stack and does a single move of the loop variable into the `eax` register to
compare with the `width` on the stack.

Conclusion
----------

This post demonstrates how relatively minor refactors of code can have a drastic
effect on the performance of your program. Pointer aliasing issues are not as
obvious if you include global variables in your program as even though you
don't explicitly dereference memory, the compiler may still have to.

It's worth reiterating that the 35% performance hit was only obvious in an
optimised build. Therefore, it is my opinion that programs should be regularly
built with optimisations on and only turn them off when you need to debug logic
errors.  Performance bugs are better investigated using a profiler like `perf`,
in my opinion.

Many programmers may disparage C due to issues like this, but I feel that the
offer of a performance gain from understanding how these problems occur is an
advantage of the C family of languages over the higher-level languages that
abstract that decision away for simplicity, often leaving you with the
worse-case performance anyway.

I hope you found this post interesting. Thank you for reading.

---

[^1]: To my knowledge, `perf` interrupts the program and inspects the instruction pointer to figure what part of the program is currently executing. For this reason it can often miss-associate the samples with instructions around the hot region, as can be seen with the 31.84 measurement being attributed with the `cmp` instruction rather than the `mov` directly before it.  

