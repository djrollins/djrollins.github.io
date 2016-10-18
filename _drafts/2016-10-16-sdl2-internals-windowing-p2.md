---
layout: post
title: "SDL2 Internals: Windowing Subsystem (Part II)"
description: ""
tags: [sdl2, gamedev, linux, shared-libraries, linker]
---

## How SDL2 loads X11 dynamically

In the interest of brevity, we're only going to focus on one of the libraries
on one of the platforms, specifically X11 on Linux, though the process is fairly
similar across all of the others.

The way SDL2 simplifies the loading of all of the X11 symbols involves the
repeated inclusion of the SDL_x11sym.h header file. This header file includes
*many* macro invocations that summarise each of the library's functions

```c
SDL_X11_SYM(ReturnType,FunctionName,FunctionParams,FunctionArguments,ReturnExpression);
```

The `ReturnExpression` doesn't seem to be used anywhere as far as I can tell,
though I hazard a guess that it was once used to specify the return expression
of a stub function for each prototype.

Regardless, as an example, the `XOpenDisplay` function, which has the prototype:

```c
Display *XOpenDisplay(_Xconst char *a);
```

Is expressed in the SDL_X11_SYM macro as:

```c
SDL_X11_SYM(Display*,XOpenDisplay,(_Xconst char* a),(a),return)
```

In key parts of the code where SDL needs act on these function prototypes, The
`SDL_X11_SYM` macro is redefined to a useful bit of code and the SDL_x11sym.h
header is included directly underneath it so that the macro invocations are
expanded to the new definition.

The first point where this is used is int he SDL_x11dyn.h header, where it is
used to define all of the function pointers;

```c
#define SDL_X11_SYM(rc,fn,params,args,ret) \
    typedef rc (*SDL_DYNX11FN_##fn) params; \
    extern SDL_DYNX11FN_##fn X11_##fn;
#include "SDL_x11sym.h"
```

This macro creates a `typdef` for a function pointer with the signature of the
required function. It then creates an `extern` declaration of this function
pointer to be defined later.

Our `XOpenDisplay` example would expand to:

```c
typedef Display *(*SDL_DYNX11FBN_XOpenDisplay)(_Xconst char *a);
extern SDL_DYNX11FBN_XOpenDisplay X11_XOpenDisplay;
```

The second point where this trick is used is during the bootstrap process
outlined above. The symbols are loaded to check if the library is available and
again to create the `VideoDevice`. The procedure responsible for this is the
`SDL_X11_LoadSymbols` function in the SDL_x11dyn.c compilation unit.

