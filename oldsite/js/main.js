var pageId,
    pageElements = [],
    headerLinkByhref = {};

document.addEventListener("DOMContentLoaded", function() {
    var pages = ["home", "aboutme", "contact"];

    setupPageResizer();
    handleScrollEvent();
    pages.forEach(registerPage);
});

function setupPageResizer() {
    window.onresize = function() {
        var windowHeight = window.innerHeight.toString() + "px",
            pages = document.querySelectorAll(".page");
        
        Array.prototype.forEach.call(pages, function(page) {
            pageElements.push(page);
            page.style.minHeight = windowHeight;
        });
    };
    
    window.onresize();
}

function handleScrollEvent() {
	window.addEventListener('scroll', function() {
        var distanceY = window.pageYOffset || document.documentElement.scrollTop,
	    	shrinkOn = 100,
		    header = document.querySelector(".navbar"),
            currPage;

		if (distanceY > shrinkOn) {
			header.className = "navbar collapsed";
		} else {
			header.className = "navbar";
		}

        currPage = pageElements.reduce(function (prev, curr) {
            return (curr.offsetTop - distanceY < 50) ? curr : prev;
        });
        
        setHeaderPage(currPage.id);
	});
}

function registerPage(pageName) {
    var target = document.querySelector("a[name='" + pageName + "']"),
        links = document.querySelectorAll("a[href='#" + pageName + "']"),
        callback = setHeaderPage.bind(this, pageName);

    Array.prototype.forEach.call(links, function(link) {
        link.removeAttribute("href");
        link.addEventListener('click',
            animatedScrollTo.bind(link, document.body, target, 1000, callback));
    });
} 

function setHeaderPage(pageName) {
    var prevPage = document.querySelector(".current-page")
        nextPage = document.querySelector("#" + pageName + "-nav");

    if (prevPage) {
        prevPage.removeAttribute("class");
    }
    if (nextPage) {
        nextPage.className = "current-page";
    }
}
