#include "widget.h"

int Widget::value() const { return 1; }

int Derived::value() const { return 2; }

int compute(const Widget &w) { return w.value(); }
