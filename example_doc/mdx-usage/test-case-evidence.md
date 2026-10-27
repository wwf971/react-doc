---
title: Test case evidence
description: The evidence document of the test case table demonstration
language: en
---

This is the evidence document referred to by the records of the [test case table](comp-test-case-table.md#test-case-table-asset) demonstration. An evidence document is an ordinary document of the doc page: it is not listed in the side panel, and the records keep it in a build as their dependency.

## Login form, empty submit

Checked in the development server with a browser simulation: the form submitted with both fields empty marks both fields and sends nothing; the request log stays empty.

## Login form, wrong password

Checked the same way: the response is the generic "address or password is wrong" message, and the address field keeps its value.
