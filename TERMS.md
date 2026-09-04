# DuploCloud Extension Developer Kit — Proprietary Component License Terms

**Last updated: 2026-08-07**

These Proprietary Component License Terms ("**Terms**") are between you and **DuploCloud,
Inc.**, a Delaware corporation with its principal place of business at 2150 N First St, San
Jose, CA 95131 ("**DuploCloud**"), and they govern your use of the proprietary DuploCloud
components this Repository (defined below) includes, references, or pulls:

- the DuploCloud **container images** this Repository includes, references, or pulls
  (including images referenced by `docker-compose.yml`, `.env`, `.env.example`, or any script
  under `scripts/`), together with all of their tags, layers, and contents, including any of
  the foregoing added to the dev kit after the date of these Terms (the "**Licensed
  Images**"), and
- the compiled DuploCloud **software library** distributed in or referenced by this
  Repository as a package artifact, together with all of its files, bundles, type
  declarations, and contents, including any of the foregoing added to the dev kit after the
  date of these Terms (the "**Licensed Library**" and, together with the Licensed Images, the
  "**Licensed Software**").

By pulling, running, installing, building against, or otherwise using the Licensed Software,
you agree to these Terms. If you do not agree, you may not use the Licensed Software. THESE
TERMS INCLUDE AN AGREEMENT TO ARBITRATE, INCLUDING A CLASS ACTION WAIVER, IN SECTION 15.

If you pull, run, install, build against, or otherwise use the Licensed Software on behalf of
an entity, you agree to these Terms on behalf of that entity and represent and warrant that
you have the authority to bind that entity, and all references to "you" throughout refer to
that entity. These Terms are a **separate agreement** from the Apache License, Version 2.0
provided in the License file in this Repository, which governs the source files in this
Repository. See [LICENSE](LICENSE) and [NOTICE](NOTICE). "**Repository**" means the DuploCloud
Extension Developer Kit git repository originally published by DuploCloud at
github.com/Duplocloud/duplo-ai-extension-devkit (or such other location as DuploCloud may
designate), together with any clone, fork, mirror, or other copy of it, regardless of the
remote origin, branch, or git history under which that copy is maintained.

## 1. Scope

### 1.1 Not Open Source

**The Licensed Software is proprietary software owned by DuploCloud. It is not open source.**
It is the compiled output of DuploCloud's private duplo-ui portal source code, it is published
only to a private, access-controlled registry, and it carries no license of its own. It is
included in this Repository solely so that you can build extensions without credentials for
that private registry — **not** as a grant of open source rights.

### 1.2 Relationship with other agreements

**(a) Separate agreements take precedence.** If you have a separate written agreement with
DuploCloud covering any Licensed Software — a subscription, order form, or other license —
that agreement governs your use of that portion of the Licensed Software in place of these
Terms.

**(b) Separately licensed components are excluded.** If DuploCloud distributes an image or a
library under its own open source or other license, that license governs and the component is
not Licensed Software.

### 1.3 What these Terms do not cover

These Terms do not apply to, and place no restriction on, your use of:

**(a) The source files in this Repository authored by DuploCloud** — including `run.sh`,
`stop.sh`, `logs.sh`, `scripts/`, `docker-compose.yml`, `nginx/`, `samples/`, and `.claude/`.
Those are licensed to you under the terms set forth in the License file in this Repository.
See [LICENSE](LICENSE).

**(b) Extensions you author.** See Section 6.

**(c) Third-party container images** referenced by this Repository, such as `mongo`. Those
are licensed by their respective publishers under their own terms.

**(d) Third-party open source packages** that the samples install from public registries, such
as the Angular packages. Those are licensed by their respective publishers under their own
terms.

## 2. License grant

Subject to these Terms, DuploCloud grants you a limited, non-exclusive, non-transferable,
non-sublicensable, revocable license to:

**(a)** pull, run, use, and reproduce the Licensed Images solely within a Development
Environment to develop, build, test, and evaluate DuploCloud platform extensions;

**(b)** install, use and reproduce the Licensed Library in object code form (together with any
type declarations among the Licensed Library), and compile and link your extension code
against it, in each case, solely to develop, build, test, and deploy DuploCloud platform
extensions; and

**(c) distribute the portions of the Licensed Library that your build tooling incorporates
into your compiled extension bundle**, solely as part of that bundle and solely for
installation onto a DuploCloud platform that you are licensed to use, and, solely to the extent
your build tooling performs non-substantive technical transformations for that purpose (such as
minification, tree-shaking, transpilation, or bundling), **prepare such technical adaptations
of the Licensed Library**.

Sections 2(b) and (c) exist because the extension build bundles the Licensed Library into your
extension's compiled output rather than loading it from the host platform. For the avoidance of
doubt, it permits that one distribution path and no other. It is not permission to distribute
the Licensed Library on its own, in source or package form, or as anything other than an
incorporated part of a compiled extension bundle.

No rights are granted other than those expressly stated here. DuploCloud reserves all other
rights. **In particular, no rights are granted to the DuploCloud source code from which the
Licensed Software is built.** **No patent license is granted under this Section or under these
Terms, by implication, estoppel, or otherwise.**

## 3. Development use only

For clarity, the Licensed Images are for local, internal development and evaluation only in a
Development Environment. You may not use, or permit any third party to use, them in Production
Use.

3.1 **"Development Environment"** means a developer workstation, or an isolated development or
test environment, used solely by you or your organization's personnel to build and evaluate
extensions.

3.2 **"Production Use"** means any use of the Licensed Images: (a) in a live, customer-facing,
revenue-generating, or business-operations environment; (b) to serve, or otherwise make
functionality available to, real end users; (c) to process, store, or transmit production data,
customer data, or personal data; (d) in any deployment outside a Development Environment,
including any shared, staging, hosted, or internet-accessible deployment intended for
operational use; or (e) by more than one individual user connected to the same running instance
of the Licensed Images at a time, regardless of whether clause (a), (b), (c), or (d) also
applies.

3.3 Production Use is **not licensed** under these Terms and is expressly prohibited. To use
DuploCloud software in production you must obtain a separate production license. See Section 7.

3.4 **The Licensed Library is treated differently**, because extensions are meant to be
deployed. Section 2(b) permits you to install a compiled extension containing the Licensed
Library onto a production DuploCloud platform, provided you are licensed to use that platform
in production. It grants no right to run the Licensed Library anywhere else.

## 4. Restrictions

You may not, and may not permit or enable anyone else to: (a) **modify the Licensed Software,
or create derivative works of it**, in whole or in part, under any circumstances, except as
part of the technical adaptations expressly permitted under Section 2(b); (b) reverse engineer,
decompile, disassemble, deobfuscate, or attempt to derive the source code of the Licensed
Software or of any software it contains, except to the extent this restriction is unenforceable
under applicable law; (c) extract, unpack, repackage, rebuild, or redistribute any layer,
filesystem, binary, library, model, bundle, or other component of the Licensed Software,
whether modified or not — **except** for the incorporation of the Licensed Library into your
compiled extension bundle expressly permitted by Section 2(b); (d) republish, mirror, host,
sublicense, rent, lease, sell, or otherwise make the Licensed Software available to any third
party — including publishing the Licensed Library, or any part of it, to any public or private
package registry, or committing it to any repository other than this Repository; (e) remove,
obscure, or alter any copyright, trademark, license, or other proprietary notice contained in
or displayed by the Licensed Software or this Repository, including the `NOTICE` files
distributed alongside the vendored library tarballs; (f) circumvent, disable, tamper with, or
exceed any license limit, usage cap, metering, or technical restriction in the Licensed
Software (see Section 5); or (g) use the Licensed Software to develop, train, or operate a
product or service that competes with the Licensed Software or any business of DuploCloud.

**Nothing in this Section** restricts what you may do with the software provided in this
Repository subject to separate license terms.

## 5. License keys and usage limits

5.1 The Licensed Software may require a license key issued by DuploCloud and may enforce
limits, such as a maximum number of users.

5.2 Those limits are **terms of this license**, not merely technical characteristics of the
software. Operating outside them — including by circumventing, patching, or otherwise defeating
their enforcement — is a material breach of these Terms, whether or not doing so is technically
possible.

5.3 A development license key authorizes only the Development Environment use described in
Section 3.

## 6. Your extensions are yours

DuploCloud claims no ownership of, and no license to, your extensions. Nothing in these Terms
gives DuploCloud any rights in your extensions, your data, or your applications.

For clarity: this does not transfer ownership of the Licensed Library. Where your compiled
extension bundle incorporates portions of the Licensed Library, DuploCloud continues to own
those portions, and your rights in them are the ones granted by Section 2(b). Everything you
wrote remains yours.

## 7. Going to production

When you are ready to run a use case that qualifies as Production Use, contact DuploCloud at
**sales@duplocloud.net** to obtain a production license. Production Use, if permitted, would be
governed by a separate agreement and is not permitted by these Terms.

## 8. Term and termination

8.1 These Terms apply for as long as you use the Licensed Software, unless you enter into a
separate agreement covering the Licensed Software as described above.

8.2 Your license terminates automatically and immediately if you breach any of these Terms.

8.3 DuploCloud may terminate or suspend this license at any time.

8.4 On termination you must stop using the Licensed Software and delete all copies of it in
your possession or control. Sections 3, 4, 5, 6, 8.4, 8.5, and 9–16 survive termination.

8.5 Termination of these Terms does not affect the license granted under Section 2(c) with
respect to compiled extension bundles you distributed before termination. Those bundles
continue to be governed by Section 2(c) as if these Terms had not terminated, but nothing in
these Terms grants you rights to create or distribute any new compiled extension bundle after
termination.

## 9. No warranty

THE LICENSED SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OR CONDITION
OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY WARRANTY OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT. THE LICENSED
SOFTWARE IS DEVELOPMENT-ONLY SOFTWARE AND HAS NOT BEEN QUALIFIED FOR PRODUCTION USE. YOU
BEAR THE ENTIRE RISK OF USING IT.

DuploCloud has no obligation to provide support, maintenance, updates, or bug fixes for the
Licensed Software.

## 10. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, DUPLOCLOUD WILL NOT BE LIABLE FOR ANY
INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY
LOST PROFITS, REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR RELATING TO THE LICENSED
SOFTWARE OR THESE TERMS, REGARDLESS OF THE THEORY OF LIABILITY AND EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGES. DUPLOCLOUD'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR
RELATING TO THESE TERMS WILL NOT EXCEED ONE HUNDRED U.S. DOLLARS (US$100). DUPLOCLOUD HAS NO
INDEMNITY OBLIGATIONS, EXPRESS OR IMPLIED, UNDER THESE TERMS.

## 11. Trademarks

These Terms do not grant any right to use the DuploCloud name, logos, trade names, trademarks,
or service marks.

## 12. Changes to these Terms

DuploCloud may update these Terms from time to time, which updates will take effect the next
time you use the Licensed Software. You are responsible for checking for updates to these
Terms.

## 13. Export control

The Licensed Software may be subject to U.S. export control laws, including the Export
Administration Regulations (EAR) administered by the U.S. Department of Commerce. You represent
and warrant that you are not located in, organized under the laws of, or ordinarily resident in
any country or region subject to comprehensive U.S. sanctions, and that you are not identified
on any list of parties prohibited from receiving U.S. exports, including the Entity List, the
Denied Persons List, or the Specially Designated Nationals List. You will not export,
re-export, or transfer the Licensed Software in violation of applicable U.S. export control or
sanctions laws.

## 14. Government rights

The Licensed Software is "commercial computer software" and "commercial computer software
documentation" as those terms are defined in 48 C.F.R. § 2.101, and is provided to the U.S.
Government only with the rights customarily provided to the public under these Terms,
consistent with 48 C.F.R. §§ 12.212 and 227.7202-1 through 227.7202-4 (or, for DoD
acquisitions, 48 C.F.R. § 252.227-7014, as applicable).

## 15. Governing law

This Agreement shall be governed by and construed in accordance with the laws of the State of
California, without giving effect to any principles of conflicts of law.

## 16. Questions

- Licensing and Production Use: **sales@duplocloud.net**
- Security reports: **ai-reporting@duplocloud.net** (see [SECURITY.md](SECURITY.md))
