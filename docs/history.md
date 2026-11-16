---
title: History
---

<script setup>
import HistoryTimeline from './.vitepress/theme/home/HistoryTimeline.vue'
</script>

# History

Contentia predates LLMs. The core parts were created and coded way back before LLMs were mainstream.

<HistoryTimeline />

## 2016: a schema-to-form generator

The project started all the way back in 2016, when I started to experiment with the same schema →
form generator that I had been using for my own clients' CMS systems back then. As it grew more
complex I could eventually model a client's content schema with a higher-order schema. At that point
I had a content-model editor, or a Turing-complete schema-to-form generator if you will.

This is where the rabbit hole to a perfectly loosely coupled CMS came from. I just didn't realize
how difficult it is to make an agnostic, headless content system that is actually useful 🫠. Through
trial and error I eventually figured out that I needed to think in different layers. Domain driven
design concepts helped a lot with this; you'll see a lot of DDD-lite across this codebase. The never
ending struggle between usefulness and complexity led to a layered architecture.

## The object at the core

At the core of Contentia sits something called an [object](./concepts/content-model). Think of it a
little bit like an AWS S3 object. It can represent anything that is uniquely addressable:

- choices for a select input (`red`, `green` and `blue` as three objects without a value)
- records in a database
- pages on a website
- metrics from a sensor

This is the core of Contentia, and in theory it's a lot more than a CMS. It's a contract that could
be used in many other applications: any system that wants to make content from any source
addressable through one homogeneous surface.

Outside of that core are layers (a union model), which make more and more assumptions the further
away you get. The [architecture](./concepts/architecture) page walks through them. The reason you
are using Contentia is probably that you did not want to model your domain around your CMS, so the
goal is to get you 90% there. You will most likely implement or extend an existing repository to
make it fit your infrastructure.

After all this explaining, the original point of simplicity might seem counterintuitive. When you
start looking at your content this way, you'll see how natural it is and you'll quickly forget the
jargon. Almost all CMSs do what we just did; they hide the complexity and tightly couple concepts
that don't need to be tightly coupled, for "convenience".

## 2018: almost released

Around 2018, during the JAMstack era, I came very close to releasing the project. The maintenance of
such a big monorepo and the scale of the project caught up with me. Trimming it further would have
destroyed the main mechanics that made it worth using. The project also carried all the technical
debt of all the previous mistakes and bad assumptions I had made.

## Claude

Without a team or a big budget, I could not have turned these ideas into a useful library. Claude
made that possible. It allowed me to build a large project from one mental model instead of
splitting it across a team, which I believe has led to an amazing result. Some parts of Contentia
may look strange at first. They have been designed, created, discarded, and rebuilt repeatedly until
the core became truly headless, backend-agnostic, and modular.

Claude made it possible to revive this JAMstack-era idea and fix the assumptions that stopped the
earlier version from shipping. It matters more now than it did then, and it keeps becoming more
relevant: writing code is cheaper, and LLMs need homogeneous access to information from different
sources. Contentia makes content from those sources addressable through one surface.

If you do not trust AI-assisted code, don't use Contentia for now. I am choosing highly creative and
fast growth over stability at this stage. Stability will come from production use, open-source
contributions, sponsorship, and the commercial success of projects using Contentia.

## Contentia and Laika CMS

Until October 2026 the whole project was called Laika CMS. Then I split it. The content API, the
part that started in 2016, became Contentia. Laika CMS is now the opinionated CMS built on top of
it: an admin UI, its server pieces and starters. What is called Contentia today is the old part;
Laika CMS as it exists today is the newer layer on top.

The Laika CMS admin is a fork of [Decap CMS](https://decapcms.org/) that has been rebuilt from the
ground up with the same layered approach: an agnostic core with opinionated outer layers. I kept the
Decap core and extracted the opinionated parts into a separate package, because I don't want a fork
that only works with my own project. It is a well deserved thank-you to the Decap CMS maintainers
for creating a CMS that is already (mostly) backend-agnostic and headless.

Before adopting Contentia, read the
[roadmap](https://github.com/contentia-dev/contentia/blob/develop/ROADMAP.md), the
[security policy](https://github.com/contentia-dev/contentia/blob/develop/SECURITY.md), the
[changelog](./CHANGELOG) and the
[contribution guide](https://github.com/contentia-dev/contentia/blob/develop/CONTRIBUTING.md).
