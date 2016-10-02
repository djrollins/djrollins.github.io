---
layout: default
title: Tags
---

Tags
====

<ul class="tag-list">
{% for tag in site.tags %}
        {% capture tag_name %}{{ tag | first }}{% endcapture %}
        <li class="tag">
            <a href="#{{ tag_name }}">
                <span class="tag-name">{{ tag_name }}</span >
                <span class="tag-count">{{ site.tags[tag_name].size }}</span>
            </a>
        </li>
{% endfor %}
</ul>

{% for tag in site.tags %}
{% capture tag_name %}{{ tag | first }}{% endcapture %}
<div class="posts-by-tag" id="{{ tag_name }}">
<h4>{{ tag_name }}</h4>
<ul>
{% for post in site.tags[tag_name] %}
    <li class="tag-post">
        <a href="{{ post.url }}">
            {{ post.title }}
        </a>
    </li>
{% endfor %}
</ul>
{% endfor %}
