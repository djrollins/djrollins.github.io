---
layout: default
title: Archive
---

Archive
=======

<ul class="archive">
{% for post in site.posts %}
    <li class="archive-entry">
        <a href="{{ post.url }}">
            <span class="archive-entry-title">{{ post.title }}</span>
            <span class="archive-entry-date">| {{ post.date | date_to_string }}</span>
        </a>
    </li>
{% endfor %}
</ul>
